package com.croplab.croplab.service;

import com.croplab.croplab.dto.EstadisticasEconomicasDTO;

import com.croplab.croplab.model.*;
import com.croplab.croplab.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

@Service
@RequiredArgsConstructor
public class SimulacionService {

    private final SimulacionRepository simulacionRepository;
    private final EstadoDiarioRepository estadoDiarioRepository;
    private final EventoRepository eventoRepository;
    private final ResultadoRepository resultadoRepository;
    private final Random random = new Random();

    @Transactional
    public Simulacion crearSimulacion(Simulacion simulacion, Long userId) {
        simulacion.setIdUsuario(userId);
        // El presupuesto actual arranca igual al inicial elegido por el usuario
        if (simulacion.getPresupuestoInicial() != null) {
            simulacion.setPresupuestoActual(simulacion.getPresupuestoInicial());
        }
        if (simulacion.getDiasMaximos() == null || simulacion.getDiasMaximos() < 1) {
            simulacion.setDiasMaximos(180);
        }
        return simulacionRepository.save(simulacion);
    }

    public List<Simulacion> obtenerSimulacionesPorUsuario(Long userId) {
        return simulacionRepository.findByIdUsuario(userId);
    }

    public Simulacion obtenerSimulacionPorId(Long id, Long userId) {
        Simulacion simulacion = simulacionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));

        if (!simulacion.getIdUsuario().equals(userId)) {
            throw new RuntimeException("No tienes permiso para acceder a esta simulación");
        }

        return simulacion;
    }

    /**
     * Avanza N días en una sola transacción. Mucho más rápido que llamar a avanzarDia N veces
     * porque carga la simulación + eventos UNA VEZ y mantiene todo en memoria.
     */
    @Transactional
    public EstadoDiario avanzarVariosDias(Long simulacionId, int n, Long userId) {
        if (n < 1) throw new RuntimeException("El número de días debe ser al menos 1");
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        if (!simulacion.getEstado().equals(Simulacion.Estado.en_curso)) {
            throw new RuntimeException("La simulación no está en curso");
        }

        // Carga eventos UNA SOLA VEZ; los nuevos eventos generados los añadimos al cache.
        List<Evento> eventosCache = new java.util.ArrayList<>(
                eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacionId));
        List<EstadoDiario> estadosBatch = new java.util.ArrayList<>();
        List<Evento> eventosNuevos = new java.util.ArrayList<>();
        EstadoDiario ultimoEstado = null;

        for (int i = 0; i < n; i++) {
            simulacion.setDiaActual(simulacion.getDiaActual() + 1);
            EstadoDiario estado = calcularEstadoDiario(simulacion, eventosCache);
            estadosBatch.add(estado);

            simulacion.setSaludActual(estado.getSaludPlanta());
            simulacion.setAlturaActual(estado.getAlturaCm());
            simulacion.setHumedadSueloActual(estado.getHumedadSuelo());
            simulacion.setEtapaFenologica(estado.getEtapaFenologica());

            if (Boolean.TRUE.equals(simulacion.getEventosAleatorios()) && random.nextDouble() < 0.25) {
                Evento nuevo = construirEventoAleatorio(simulacion);
                eventosNuevos.add(nuevo);
                eventosCache.add(nuevo);
            }

            ultimoEstado = estado;
            // Si la planta murió, paramos el bucle (no tiene sentido avanzar más días)
            if (simulacion.getEstado() == Simulacion.Estado.fallida) break;
        }

        // Persistencia en batch — un único viaje a BBDD por entidad
        estadoDiarioRepository.saveAll(estadosBatch);
        if (!eventosNuevos.isEmpty()) eventoRepository.saveAll(eventosNuevos);
        actualizarIngresosEstimados(simulacion);
        simulacionRepository.save(simulacion);

        // Si la planta murió durante el batch, generamos el Resultado automáticamente
        if (simulacion.getEstado() == Simulacion.Estado.fallida
                && resultadoRepository.findByIdSimulacion(simulacionId).isEmpty()) {
            finalizarSimulacion(simulacionId, userId);
        }

        return ultimoEstado;
    }

    @Transactional
    public EstadoDiario avanzarDia(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);

        if (!simulacion.getEstado().equals(Simulacion.Estado.en_curso)) {
            throw new RuntimeException("La simulación no está en curso");
        }

        // Incrementar día
        simulacion.setDiaActual(simulacion.getDiaActual() + 1);

        // Calcular nuevo estado diario
        EstadoDiario estadoDiario = calcularEstadoDiario(simulacion);
        estadoDiarioRepository.save(estadoDiario);

        // Actualizar estado de la simulación
        simulacion.setSaludActual(estadoDiario.getSaludPlanta());
        simulacion.setAlturaActual(estadoDiario.getAlturaCm());
        simulacion.setHumedadSueloActual(estadoDiario.getHumedadSuelo());
        simulacion.setEtapaFenologica(estadoDiario.getEtapaFenologica());

        // Generar eventos aleatorios MÁS FRECUENTEMENTE para mayor dificultad
        // (solo si el usuario los tiene activados para esta simulación)
        if (Boolean.TRUE.equals(simulacion.getEventosAleatorios()) && random.nextDouble() < 0.25) {
            generarEventoAleatorio(simulacion);
        }

        // Recalcular ingresos estimados según salud y etapa actuales
        actualizarIngresosEstimados(simulacion);

        simulacionRepository.save(simulacion);

        // Si la planta murió, generar Resultado automáticamente para que aparezca en comparativa
        if (simulacion.getEstado() == Simulacion.Estado.fallida
                && resultadoRepository.findByIdSimulacion(simulacionId).isEmpty()) {
            finalizarSimulacion(simulacionId, userId);
        }

        return estadoDiario;
    }

    private void actualizarIngresosEstimados(Simulacion simulacion) {
        double[] info = CULTIVO_DATA.getOrDefault(simulacion.getTipoCultivo(), new double[]{4000, 0.30});
        double rendimientoPotencial = info[0];
        double precioKg = info[1];
        double factorSalud = simulacion.getSaludActual().doubleValue() / 100.0;
        double factorEtapa = calcularFactorEtapa(simulacion.getEtapaFenologica());
        double rendimientoProyectado = rendimientoPotencial * factorSalud * factorEtapa;
        BigDecimal ingreso = BigDecimal.valueOf(rendimientoProyectado)
                .multiply(BigDecimal.valueOf(precioKg))
                .multiply(simulacion.getSuperficieHectareas())
                .setScale(2, RoundingMode.HALF_UP);
        simulacion.setIngresosEstimados(ingreso);
    }

    private EstadoDiario calcularEstadoDiario(Simulacion simulacion) {
        return calcularEstadoDiario(simulacion,
                eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacion.getIdSimulacion()));
    }

    /**
     * Versión optimizada: recibe la lista de eventos ya cargada para evitar 4+ queries
     * por cada día simulado. Indispensable cuando se avanzan muchos días en batch.
     */
    private EstadoDiario calcularEstadoDiario(Simulacion simulacion, List<Evento> eventosCache) {
        EstadoDiario estado = new EstadoDiario();
        estado.setIdSimulacion(simulacion.getIdSimulacion());
        estado.setDia(simulacion.getDiaActual());
        estado.setFechaSimulada(LocalDate.now().plusDays(simulacion.getDiaActual()));

        // Calcular humedad del suelo (disminuye MUCHO con el tiempo)
        BigDecimal humedadActual = simulacion.getHumedadSueloActual();
        double perdidaHumedad = 5 + random.nextDouble() * 8; // 5-13% de pérdida por día
        humedadActual = humedadActual.subtract(BigDecimal.valueOf(perdidaHumedad));
        humedadActual = humedadActual.max(BigDecimal.ZERO).min(BigDecimal.valueOf(100));
        estado.setHumedadSuelo(humedadActual);

        // Temperatura y precipitación (simuladas con variabilidad)
        BigDecimal temperatura = simulacion.getTemperaturaMedia().add(BigDecimal.valueOf((random.nextDouble() - 0.5) * 15));
        BigDecimal precipitacion = BigDecimal.valueOf(random.nextDouble() * 15);
        estado.setTemperatura(temperatura);
        estado.setPrecipitacionMm(precipitacion);

        // Determinar etapa fenológica
        EtapaFenologica etapa = determinarEtapaFenologica(simulacion);
        estado.setEtapaFenologica(etapa);

        // ================= CÁLCULO REALISTA DE SALUD =================
        BigDecimal saludActual = simulacion.getSaludActual();
        double penalizacionTotal = 0;

        // 1. ESTRÉS HÍDRICO (MUY IMPORTANTE)
        boolean estresHidrico = false;
        if (humedadActual.compareTo(BigDecimal.valueOf(20)) < 0) {
            // Humedad crítica < 20%
            penalizacionTotal += 8 + random.nextDouble() * 7; // -8 a -15 de salud
            estresHidrico = true;
        } else if (humedadActual.compareTo(BigDecimal.valueOf(40)) < 0) {
            // Humedad baja 20-40%
            penalizacionTotal += 3 + random.nextDouble() * 4; // -3 a -7 de salud
            estresHidrico = true;
        } else if (humedadActual.compareTo(BigDecimal.valueOf(30)) < 0) {
            // Humedad muy baja 30-40%
            penalizacionTotal += 1.5 + random.nextDouble() * 2.5; // -1.5 a -4 de salud
        }

        // 2. ESTRÉS TÉRMICO
        boolean estresTermico = false;
        if (temperatura.compareTo(BigDecimal.valueOf(35)) > 0) {
            // Temperatura muy alta
            penalizacionTotal += 4 + random.nextDouble() * 6; // -4 a -10
            estresTermico = true;
        } else if (temperatura.compareTo(BigDecimal.valueOf(5)) < 0) {
            // Temperatura muy baja
            penalizacionTotal += 5 + random.nextDouble() * 8; // -5 a -13
            estresTermico = true;
        } else if (temperatura.compareTo(BigDecimal.valueOf(30)) > 0 || temperatura.compareTo(BigDecimal.valueOf(10)) < 0) {
            // Temperatura no óptima
            penalizacionTotal += 1 + random.nextDouble() * 2; // -1 a -3
        }

        // 3. ESTRÉS NUTRICIONAL (necesita fertilización periódica)
        boolean estresNutricional = false;
        // Verificar si ha habido fertilización en los últimos 15 días (en el cache, sin query)
        int diaActual = simulacion.getDiaActual();
        boolean hayFertReciente = false;
        for (Evento e : eventosCache) {
            if (e.getTipoEvento() == Evento.TipoEvento.fertilizacion
                    && e.getDiaEvento() >= diaActual - 15) { hayFertReciente = true; break; }
        }

        if (!hayFertReciente && diaActual > 15) {
            penalizacionTotal += 2 + random.nextDouble() * 4; // -2 a -6
            estresNutricional = true;
        }

        // 4. NECESIDAD DE RIEGO (verificar riegos recientes)
        boolean hayRiegoReciente = false;
        for (Evento e : eventosCache) {
            if (e.getTipoEvento() == Evento.TipoEvento.riego
                    && e.getDiaEvento() >= diaActual - 3) { hayRiegoReciente = true; break; }
        }

        if (!hayRiegoReciente && humedadActual.compareTo(BigDecimal.valueOf(50)) < 0) {
            penalizacionTotal += 3 + random.nextDouble() * 5; // -3 a -8
        }

        // 5. EVENTOS NEGATIVOS PREVIOS (plagas/enfermedades sin tratar en los últimos 10 días)
        for (Evento evento : eventosCache) {
            if (!esPlagaOEnfermedad(evento.getTipoEvento())) continue;
            if (evento.getDiaEvento() < diaActual - 10) continue;
            // Verificar si hubo tratamiento después en el mismo cache
            boolean tratado = false;
            for (Evento e : eventosCache) {
                if ((e.getTipoEvento() == Evento.TipoEvento.tratamiento_fitosanitario
                        || e.getTipoEvento() == Evento.TipoEvento.control_biologico)
                        && e.getDiaEvento() > evento.getDiaEvento()
                        && e.getDiaEvento() <= diaActual) { tratado = true; break; }
            }
            if (!tratado) {
                penalizacionTotal += 4 + random.nextDouble() * 8; // -4 a -12 por evento sin tratar
            }
        }

        // 6. DESGASTE NATURAL (pequeño)
        penalizacionTotal += 0.5 + random.nextDouble() * 1; // -0.5 a -1.5 por día

        // Aplicar penalización total (salvo si el modo invencible está activo)
        if (Boolean.TRUE.equals(simulacion.getModoInvencible())) {
            saludActual = BigDecimal.valueOf(100);
        } else {
            saludActual = saludActual.subtract(BigDecimal.valueOf(penalizacionTotal));
            saludActual = saludActual.max(BigDecimal.ZERO).min(BigDecimal.valueOf(100));
        }
        estado.setSaludPlanta(saludActual);

        // Indicadores de estrés
        estado.setEstresHidrico(estresHidrico);
        estado.setEstresTermico(estresTermico);
        estado.setEstresNutricional(estresNutricional);

        // Calcular altura (solo crece si la salud es buena)
        BigDecimal alturaActual = simulacion.getAlturaActual();
        if (saludActual.compareTo(BigDecimal.valueOf(30)) > 0) {
            // Solo crece si tiene más de 30% de salud
            double factorSalud = saludActual.doubleValue() / 100.0;
            double crecimiento = (0.3 + random.nextDouble() * 0.7) * factorSalud; // 0-1 cm dependiendo de salud
            alturaActual = alturaActual.add(BigDecimal.valueOf(crecimiento));
        }
        estado.setAlturaCm(alturaActual);

        // Si la salud llega a 0, la planta muere
        if (saludActual.compareTo(BigDecimal.ZERO) <= 0) {
            simulacion.setEstado(Simulacion.Estado.fallida);
        }

        return estado;
    }

    private EtapaFenologica determinarEtapaFenologica(Simulacion simulacion) {
        int dia = simulacion.getDiaActual();

        // Etapas basadas en porcentaje del ciclo
        if (dia <= 10) return EtapaFenologica.germinacion;
        if (dia <= 25) return EtapaFenologica.emergencia;
        if (dia <= 100) return EtapaFenologica.vegetativo;
        if (dia <= 125) return EtapaFenologica.floracion;
        if (dia <= 155) return EtapaFenologica.fructificacion;
        if (dia <= 180) return EtapaFenologica.maduracion;
        return EtapaFenologica.cosecha;
    }

    private void generarEventoAleatorio(Simulacion simulacion) {
        eventoRepository.save(construirEventoAleatorio(simulacion));
    }

    /** Construye un evento aleatorio sin persistirlo. Útil para batch en avanzarVariosDias. */
    private Evento construirEventoAleatorio(Simulacion simulacion) {
        Evento evento = new Evento();
        evento.setIdSimulacion(simulacion.getIdSimulacion());
        evento.setDiaEvento(simulacion.getDiaActual());
        evento.setOrigen(Evento.Origen.sistema);
        evento.setCosteEuros(BigDecimal.ZERO);

        // Pool de eventos negativos del sistema con descripción e intensidad por defecto
        Evento.TipoEvento[] pool = new Evento.TipoEvento[] {
                // Climáticos comunes (mayor frecuencia: aparecen varias veces)
                Evento.TipoEvento.plaga, Evento.TipoEvento.plaga,
                Evento.TipoEvento.enfermedad, Evento.TipoEvento.enfermedad,
                Evento.TipoEvento.sequia, Evento.TipoEvento.helada,
                Evento.TipoEvento.granizo, Evento.TipoEvento.viento_fuerte,
                Evento.TipoEvento.ola_calor, Evento.TipoEvento.lluvia_torrencial,
                Evento.TipoEvento.malas_hierbas,

                // Catástrofes (raras)
                Evento.TipoEvento.terremoto, Evento.TipoEvento.tornado,
                Evento.TipoEvento.inundacion, Evento.TipoEvento.nevada,
                Evento.TipoEvento.rayo_caido, Evento.TipoEvento.incendio_proximo,
                Evento.TipoEvento.niebla_persistente, Evento.TipoEvento.polvo_sahariano,
                Evento.TipoEvento.lluvia_acida,

                // Problemas de suelo
                Evento.TipoEvento.erosion_suelo, Evento.TipoEvento.salinizacion,
                Evento.TipoEvento.acidificacion_suelo,

                // Plagas y enfermedades específicas
                Evento.TipoEvento.roya, Evento.TipoEvento.mildiu, Evento.TipoEvento.oidio,
                Evento.TipoEvento.virus_mosaico,
                Evento.TipoEvento.pulgones, Evento.TipoEvento.arana_roja,
                Evento.TipoEvento.caracoles, Evento.TipoEvento.nematodos,
                Evento.TipoEvento.aves_plaga, Evento.TipoEvento.jabalies,
                Evento.TipoEvento.langostas,

                // Subrealistas / técnicos
                Evento.TipoEvento.apagon_riego, Evento.TipoEvento.contaminacion_quimica,
                Evento.TipoEvento.marabunta_hormigas, Evento.TipoEvento.ola_radiacion_uv
        };

        // Aplicar el filtro de "eventos permitidos" si la simulación tiene uno
        // configurado (Modo realista o personalización). El pool se reduce a las
        // entradas cuyo nombre aparece en el set permitido. Si el filtro queda
        // vacío (configuración inválida) usamos el pool completo como fallback.
        Evento.TipoEvento[] poolFiltrado = pool;
        String csv = simulacion.getEventosPermitidos();
        if (csv != null && !csv.trim().isEmpty()) {
            java.util.Set<String> permitidos = new java.util.HashSet<>();
            for (String p : csv.split(",")) {
                String t = p.trim();
                if (!t.isEmpty()) permitidos.add(t);
            }
            java.util.List<Evento.TipoEvento> filtrados = new java.util.ArrayList<>();
            for (Evento.TipoEvento te : pool) {
                if (permitidos.contains(te.name())) filtrados.add(te);
            }
            if (!filtrados.isEmpty()) {
                poolFiltrado = filtrados.toArray(new Evento.TipoEvento[0]);
            }
        }

        Evento.TipoEvento tipo = poolFiltrado[random.nextInt(poolFiltrado.length)];
        evento.setTipoEvento(tipo);
        evento.setDescripcion(descripcionPorDefecto(tipo));
        evento.setIntensidad(intensidadPorDefecto(tipo));

        return evento;
    }

    private String descripcionPorDefecto(Evento.TipoEvento tipo) {
        switch (tipo) {
            case plaga: return "Aparición de plaga en el cultivo";
            case enfermedad: return "Enfermedad detectada en las plantas";
            case sequia: return "Periodo de sequía prolongado";
            case helada: return "Helada nocturna afectando el cultivo";
            case granizo: return "Tormenta de granizo dañando las plantas";
            case viento_fuerte: return "Vientos fuertes sacudiendo el cultivo";
            case ola_calor: return "Ola de calor extremo sobre la parcela";
            case lluvia_torrencial: return "Lluvia torrencial saturando el suelo";
            case malas_hierbas: return "Las malas hierbas compiten con el cultivo";

            case terremoto: return "Un terremoto agrieta el suelo y daña las raíces";
            case tornado: return "Un tornado azota la parcela y arranca plantas";
            case inundacion: return "Inundación: el campo queda anegado";
            case nevada: return "Nevada inesperada cubre el cultivo";
            case rayo_caido: return "Un rayo impacta en la parcela durante una tormenta";
            case incendio_proximo: return "Un incendio cercano deja calor y cenizas sobre el cultivo";
            case niebla_persistente: return "Niebla persistente reduce la luz disponible";
            case polvo_sahariano: return "Polvo en suspensión cubre las hojas (calima sahariana)";
            case lluvia_acida: return "Lluvia ácida quema parte del follaje";

            case erosion_suelo: return "La erosión arrastra parte de la capa fértil del suelo";
            case salinizacion: return "Acumulación de sales empeora la calidad del suelo";
            case acidificacion_suelo: return "El pH del suelo baja y se vuelve demasiado ácido";

            case roya: return "Hongo de roya detectado en las hojas";
            case mildiu: return "Mildiu invade el cultivo en condiciones húmedas";
            case oidio: return "Oídio (ceniza) cubre las hojas con polvo blanco";
            case virus_mosaico: return "Virus del mosaico infecta el cultivo";
            case pulgones: return "Colonia de pulgones chupando savia de los brotes";
            case arana_roja: return "Ácaros (araña roja) atacan el envés de las hojas";
            case caracoles: return "Caracoles y babosas devoran hojas tiernas";
            case nematodos: return "Nematodos parasitan las raíces";
            case aves_plaga: return "Bandadas de aves picotean los frutos";
            case jabalies: return "Jabalíes irrumpen y revuelven el terreno";
            case langostas: return "Plaga de langostas devora la vegetación";

            case apagon_riego: return "Apagón eléctrico deja el sistema de riego inoperativo";
            case contaminacion_quimica: return "Vertido químico cercano afecta a las raíces";
            case marabunta_hormigas: return "Marabunta de hormigas excava y daña raíces";
            case ola_radiacion_uv: return "Pico anómalo de radiación UV quema las hojas";

            default: return "Evento " + tipo.name();
        }
    }

    /**
     * Devuelve una intensidad ALEATORIA pero sesgada hacia la severidad "natural"
     * del tipo. Antes este método devolvía siempre la misma intensidad para cada
     * tipo, así que un terremoto del sistema siempre era "severo" — la intensidad
     * existía como concepto pero nunca variaba. Ahora cada generación tira un dado
     * dentro del rango plausible del tipo.
     */
    private Evento.Intensidad intensidadPorDefecto(Evento.TipoEvento tipo) {
        switch (tipo) {
            // Catástrofes: rondan entre severo y crítico, alguna vez moderado
            case terremoto:
            case tornado:
            case granizo:
            case rayo_caido:
            case incendio_proximo:
            case langostas:
            case jabalies:
            case virus_mosaico:
            case contaminacion_quimica:
                return ponderada(new Evento.Intensidad[]{
                        Evento.Intensidad.moderado,
                        Evento.Intensidad.severo, Evento.Intensidad.severo,
                        Evento.Intensidad.critico
                });

            // Problemas medios: distribución equilibrada moderado/severo, raro crítico
            case sequia:
            case helada:
            case ola_calor:
            case roya:
            case mildiu:
            case oidio:
            case pulgones:
            case arana_roja:
            case nematodos:
            case inundacion:
            case nevada:
            case salinizacion:
            case erosion_suelo:
            case acidificacion_suelo:
            case apagon_riego:
            case marabunta_hormigas:
                return ponderada(new Evento.Intensidad[]{
                        Evento.Intensidad.leve,
                        Evento.Intensidad.moderado, Evento.Intensidad.moderado, Evento.Intensidad.moderado,
                        Evento.Intensidad.severo, Evento.Intensidad.severo,
                        Evento.Intensidad.critico
                });

            // Eventos leves: casi siempre leve/moderado, severo es excepcional
            case viento_fuerte:
            case lluvia_torrencial:
            case malas_hierbas:
            case niebla_persistente:
            case polvo_sahariano:
            case lluvia_acida:
            case caracoles:
            case aves_plaga:
            case ola_radiacion_uv:
                return ponderada(new Evento.Intensidad[]{
                        Evento.Intensidad.leve, Evento.Intensidad.leve, Evento.Intensidad.leve,
                        Evento.Intensidad.moderado, Evento.Intensidad.moderado,
                        Evento.Intensidad.severo
                });

            // Plaga/enfermedad genéricas: cualquier intensidad es plausible
            case plaga:
            case enfermedad:
                return ponderada(new Evento.Intensidad[]{
                        Evento.Intensidad.leve,
                        Evento.Intensidad.moderado, Evento.Intensidad.moderado,
                        Evento.Intensidad.severo, Evento.Intensidad.severo,
                        Evento.Intensidad.critico
                });

            default:
                return Evento.Intensidad.moderado;
        }
    }

    private Evento.Intensidad ponderada(Evento.Intensidad[] pool) {
        return pool[random.nextInt(pool.length)];
    }

    @Transactional
    public Evento aplicarEvento(Long simulacionId, Evento evento, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);

        evento.setIdSimulacion(simulacionId);
        evento.setDiaEvento(simulacion.getDiaActual());

        // Asignar coste realista según el tipo de evento
        BigDecimal coste = calcularCosteEvento(evento, simulacion);
        evento.setCosteEuros(coste);

        // Verificar si hay presupuesto suficiente
        if (simulacion.getPresupuestoActual().compareTo(coste) < 0) {
            throw new RuntimeException("Presupuesto insuficiente. Necesitas €" + coste + " pero solo tienes €" + simulacion.getPresupuestoActual());
        }

        // Aplicar efectos del evento
        aplicarEfectosEvento(simulacion, evento);

        // Descontar del presupuesto
        simulacion.setPresupuestoActual(simulacion.getPresupuestoActual().subtract(coste));
        simulacion.setGastosTotales(simulacion.getGastosTotales().add(coste));

        simulacionRepository.save(simulacion);

        return eventoRepository.save(evento);
    }

    private BigDecimal calcularCosteEvento(Evento evento, Simulacion simulacion) {
        BigDecimal superficie = simulacion.getSuperficieHectareas();
        BigDecimal costeBase;

        switch (evento.getTipoEvento()) {
            case riego:
                // Coste por hectárea del riego
                costeBase = new BigDecimal("15.00"); // €15/ha por riego
                return costeBase.multiply(superficie);

            case fertilizacion:
                // Coste de fertilizantes
                costeBase = new BigDecimal("80.00"); // €80/ha
                return costeBase.multiply(superficie);

            case tratamiento_fitosanitario:
                // Tratamientos son caros
                costeBase = new BigDecimal("120.00"); // €120/ha
                return costeBase.multiply(superficie);

            case poda:
                // Mano de obra
                costeBase = new BigDecimal("60.00"); // €60/ha
                return costeBase.multiply(superficie);

            // === Nuevas acciones de manejo (tienen coste para el usuario) ===
            case mulching:
                // Acolchado del suelo (paja, plástico, restos vegetales)
                costeBase = new BigDecimal("70.00"); // €70/ha
                return costeBase.multiply(superficie);

            case control_biologico:
                // Sueltas de depredadores naturales / bioinsecticida
                costeBase = new BigDecimal("90.00"); // €90/ha (más barato que fitosanitario y sin residuo)
                return costeBase.multiply(superficie);

            case enmienda_calcica:
                // Encalado para corregir pH ácido
                costeBase = new BigDecimal("55.00"); // €55/ha
                return costeBase.multiply(superficie);

            case instalacion_malla:
                // Mallas antigranizo / antipájaros / vallado
                costeBase = new BigDecimal("180.00"); // €180/ha (inversión inicial)
                return costeBase.multiply(superficie);

            case compostaje:
                // Aporte de compost orgánico
                costeBase = new BigDecimal("50.00"); // €50/ha
                return costeBase.multiply(superficie);

            case aireacion_suelo:
                // Laboreo superficial / subsolador
                costeBase = new BigDecimal("45.00"); // €45/ha
                return costeBase.multiply(superficie);

            // Eventos negativos no cuestan dinero al usuario (son daños)
            default:
                return BigDecimal.ZERO;
        }
    }

    /**
     * Multiplicador aplicado al daño (o beneficio) base de un evento según su intensidad.
     * Antes la intensidad sólo afectaba a 6-7 eventos hardcodeados; el resto ignoraba el
     * campo y aplicaba siempre el mismo daño, lo que hacía que "leve" y "crítico" se
     * sintieran idénticos en pantalla. Con este factor centralizado, cualquier evento
     * negativo se escala de forma coherente.
     */
    private double factorIntensidad(Evento.Intensidad intensidad) {
        if (intensidad == null) return 1.0;
        switch (intensidad) {
            case leve:     return 0.5;
            case moderado: return 1.0;
            case severo:   return 1.6;
            case critico:  return 2.4;
            default:       return 1.0;
        }
    }

    /** Resta `delta * factor` a la salud, sin bajar de 0.
     *  Si el modo invencible está activo, NO aplica ningún daño — los eventos
     *  negativos manuales (que el usuario dispara desde el panel) seguían
     *  bajando la vida porque este path saltaba la protección de invencible.
     */
    private void aplicarDanioSalud(Simulacion s, double delta, double factor) {
        if (Boolean.TRUE.equals(s.getModoInvencible())) return;
        BigDecimal nueva = s.getSaludActual().subtract(BigDecimal.valueOf(delta * factor));
        s.setSaludActual(nueva.max(BigDecimal.ZERO));
    }

    /** Aplica un porcentaje de pérdida de altura (clamp por tope) sin reducirla si
     *  el modo invencible está activo. Para eventos como tornado o jabalíes, que
     *  además del daño en salud reducen la altura física de la planta.
     */
    private void aplicarPerdidaAltura(Simulacion s, double porcAltura) {
        if (Boolean.TRUE.equals(s.getModoInvencible())) return;
        BigDecimal a = s.getAlturaActual().multiply(BigDecimal.valueOf(1.0 - porcAltura));
        s.setAlturaActual(a);
    }

    /** Resta `delta * factor` a la humedad del suelo, sin bajar de 0. */
    private void aplicarDanioHumedad(Simulacion s, double delta, double factor) {
        BigDecimal nueva = s.getHumedadSueloActual().subtract(BigDecimal.valueOf(delta * factor));
        s.setHumedadSueloActual(nueva.max(BigDecimal.ZERO));
    }

    private void aplicarEfectosEvento(Simulacion simulacion, Evento evento) {
        final double f = factorIntensidad(evento.getIntensidad());
        switch (evento.getTipoEvento()) {
            case riego:
                // Aumentar humedad del suelo significativamente
                BigDecimal nuevaHumedad = simulacion.getHumedadSueloActual().add(BigDecimal.valueOf(35));
                simulacion.setHumedadSueloActual(nuevaHumedad.min(BigDecimal.valueOf(100)));
                // Pequeña mejora de salud por riego oportuno
                BigDecimal saludRiego = simulacion.getSaludActual().add(BigDecimal.valueOf(2));
                simulacion.setSaludActual(saludRiego.min(BigDecimal.valueOf(100)));
                break;

            case fertilizacion:
                // Mejorar salud considerablemente
                BigDecimal nuevaSalud = simulacion.getSaludActual().add(BigDecimal.valueOf(12));
                simulacion.setSaludActual(nuevaSalud.min(BigDecimal.valueOf(100)));
                break;

            case tratamiento_fitosanitario:
                // Mejorar salud muy significativamente (cura problemas)
                BigDecimal saludMejorada = simulacion.getSaludActual().add(BigDecimal.valueOf(20));
                simulacion.setSaludActual(saludMejorada.min(BigDecimal.valueOf(100)));
                break;

            case poda:
                // Mejora moderada de salud
                BigDecimal saludPoda = simulacion.getSaludActual().add(BigDecimal.valueOf(8));
                simulacion.setSaludActual(saludPoda.min(BigDecimal.valueOf(100)));
                break;

            case plaga:
                // Daño base 18 (moderado) → leve 9, severo 29, crítico 43
                aplicarDanioSalud(simulacion, 18, f);
                break;

            case enfermedad:
                // Daño base 22 (moderado) → leve 11, severo 35, crítico 53
                aplicarDanioSalud(simulacion, 22, f);
                break;

            case malas_hierbas:
                aplicarDanioSalud(simulacion, 8, f);
                break;

            case sequia:
                aplicarDanioHumedad(simulacion, 45, f);
                aplicarDanioSalud(simulacion, 15, f);
                break;

            case helada:
                aplicarDanioSalud(simulacion, 25, f);
                break;

            case ola_calor:
                aplicarDanioHumedad(simulacion, 30, f);
                aplicarDanioSalud(simulacion, 12, f);
                break;

            case lluvia_torrencial: {
                // La saturación al 100% siempre ocurre; lo que escala es el daño por exceso
                simulacion.setHumedadSueloActual(BigDecimal.valueOf(100));
                aplicarDanioSalud(simulacion, 5, f);
                break;
            }

            case granizo:
                aplicarDanioSalud(simulacion, 22, f);
                break;

            case viento_fuerte:
                aplicarDanioSalud(simulacion, 10, f);
                break;

            // ================= NUEVOS EVENTOS CATASTRÓFICOS =================
            case terremoto:
                aplicarDanioSalud(simulacion, 18, f);
                aplicarDanioHumedad(simulacion, 15, f);
                break;
            case tornado: {
                aplicarDanioSalud(simulacion, 30, f);
                // El factor también acelera la pérdida de altura: leve poda un 15%,
                // moderado un 30%, severo un 48%, crítico un 72% (con tope al 80%)
                aplicarPerdidaAltura(simulacion, Math.min(0.80, 0.30 * f));
                break;
            }
            case inundacion:
                simulacion.setHumedadSueloActual(BigDecimal.valueOf(100));
                aplicarDanioSalud(simulacion, 20, f);
                break;
            case nevada:
                aplicarDanioSalud(simulacion, 18, f);
                break;
            case rayo_caido:
                aplicarDanioSalud(simulacion, 15, f);
                break;
            case incendio_proximo:
                aplicarDanioSalud(simulacion, 25, f);
                aplicarDanioHumedad(simulacion, 25, f);
                break;
            case niebla_persistente:
                aplicarDanioSalud(simulacion, 5, f);
                break;
            case polvo_sahariano:
                aplicarDanioSalud(simulacion, 7, f);
                break;
            case lluvia_acida:
                aplicarDanioSalud(simulacion, 10, f);
                break;

            // ================= PROBLEMAS DEL SUELO =================
            case erosion_suelo:
                aplicarDanioSalud(simulacion, 10, f);
                break;
            case salinizacion:
                aplicarDanioSalud(simulacion, 12, f);
                aplicarDanioHumedad(simulacion, 10, f);
                break;
            case acidificacion_suelo:
                aplicarDanioSalud(simulacion, 10, f);
                break;

            // ================= PLAGAS Y ENFERMEDADES ESPECÍFICAS =================
            case roya:
            case mildiu:
            case oidio:
                aplicarDanioSalud(simulacion, 14, f);
                break;
            case virus_mosaico:
                aplicarDanioSalud(simulacion, 16, f);
                break;
            case pulgones:
            case arana_roja:
                aplicarDanioSalud(simulacion, 12, f);
                break;
            case caracoles:
                aplicarDanioSalud(simulacion, 8, f);
                break;
            case nematodos:
                aplicarDanioSalud(simulacion, 15, f);
                break;
            case aves_plaga:
                aplicarDanioSalud(simulacion, 8, f);
                break;
            case jabalies: {
                aplicarDanioSalud(simulacion, 22, f);
                // Daño físico que escala con intensidad (15% base, hasta 36% en crítico)
                aplicarPerdidaAltura(simulacion, Math.min(0.50, 0.15 * f));
                break;
            }
            case langostas:
                aplicarDanioSalud(simulacion, 25, f);
                break;

            // ================= EVENTOS TÉCNICOS / SUBREALISTAS =================
            case apagon_riego:
                aplicarDanioHumedad(simulacion, 25, f);
                break;
            case contaminacion_quimica:
                aplicarDanioSalud(simulacion, 22, f);
                break;
            case marabunta_hormigas:
                aplicarDanioSalud(simulacion, 9, f);
                break;
            case ola_radiacion_uv:
                aplicarDanioSalud(simulacion, 8, f);
                break;

            // ================= NUEVAS ACCIONES DE MANEJO (usuario) =================
            case mulching: {
                // Acolchado: retiene humedad y reduce malas hierbas
                BigDecimal h = simulacion.getHumedadSueloActual().add(BigDecimal.valueOf(20));
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(5));
                simulacion.setHumedadSueloActual(h.min(BigDecimal.valueOf(100)));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                break;
            }
            case control_biologico: {
                // Alternativa al fitosanitario: menos potente, sin residuo
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(15));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                break;
            }
            case enmienda_calcica: {
                // Cal agrícola: corrige pH ácido y mejora estructura
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                break;
            }
            case instalacion_malla: {
                // Barrera física: pequeña mejora directa, protege a futuro
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(5));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                break;
            }
            case compostaje: {
                // Aporte orgánico: mejora salud y retención
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(10));
                BigDecimal h = simulacion.getHumedadSueloActual().add(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                simulacion.setHumedadSueloActual(h.min(BigDecimal.valueOf(100)));
                break;
            }
            case aireacion_suelo: {
                // Mejora oxígeno de raíces, ayuda tras inundación/terremoto
                BigDecimal s = simulacion.getSaludActual().add(BigDecimal.valueOf(8));
                simulacion.setSaludActual(s.min(BigDecimal.valueOf(100)));
                break;
            }

            default:
                break;
        }
    }

    public List<EstadoDiario> obtenerHistorial(Long simulacionId, Long userId) {
        obtenerSimulacionPorId(simulacionId, userId); // Verificar permisos
        return estadoDiarioRepository.findByIdSimulacionOrderByDiaAsc(simulacionId);
    }

    public List<Evento> obtenerEventos(Long simulacionId, Long userId) {
        obtenerSimulacionPorId(simulacionId, userId); // Verificar permisos
        return eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacionId);
    }

    // Rendimiento esperado (kg/ha) y precio de mercado (€/kg) por cultivo
    private static final Map<Simulacion.TipoCultivo, double[]> CULTIVO_DATA = Map.ofEntries(
        Map.entry(Simulacion.TipoCultivo.trigo,     new double[]{4500,  0.25}),
        Map.entry(Simulacion.TipoCultivo.maiz,      new double[]{11000, 0.22}),
        Map.entry(Simulacion.TipoCultivo.arroz,     new double[]{6000,  0.40}),
        Map.entry(Simulacion.TipoCultivo.cebada,    new double[]{3800,  0.20}),
        Map.entry(Simulacion.TipoCultivo.tomate,    new double[]{70000, 0.80}),
        Map.entry(Simulacion.TipoCultivo.lechuga,   new double[]{35000, 1.20}),
        Map.entry(Simulacion.TipoCultivo.pimiento,  new double[]{60000, 1.50}),
        Map.entry(Simulacion.TipoCultivo.zanahoria, new double[]{45000, 0.60}),
        Map.entry(Simulacion.TipoCultivo.judia,     new double[]{2500,  1.80}),
        Map.entry(Simulacion.TipoCultivo.guisante,  new double[]{3000,  2.00}),
        Map.entry(Simulacion.TipoCultivo.soja,      new double[]{3500,  0.45}),
        Map.entry(Simulacion.TipoCultivo.girasol,   new double[]{2800,  0.50}),
        Map.entry(Simulacion.TipoCultivo.colza,     new double[]{3200,  0.42}),
        Map.entry(Simulacion.TipoCultivo.vid,       new double[]{8000,  0.70}),
        Map.entry(Simulacion.TipoCultivo.olivo,     new double[]{6000,  0.65})
    );

    @Transactional
    public Resultado finalizarSimulacion(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);

        // Solo cambiamos a "completada" si todavía estaba en curso.
        // Si la planta murió y la simulación ya está marcada como "fallida", la mantenemos.
        if (simulacion.getEstado() == Simulacion.Estado.en_curso) {
            simulacion.setEstado(Simulacion.Estado.completada);
        }
        simulacionRepository.save(simulacion);

        // Obtener datos reales del historial
        List<EstadoDiario> historial = estadoDiarioRepository.findByIdSimulacionOrderByDiaAsc(simulacionId);
        List<Evento> eventos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacionId);

        // --- Contar días de estrés reales ---
        int diasEstresHidrico = 0;
        int diasEstresTermico = 0;
        int diasEstresNutricional = 0;
        BigDecimal precipitacionTotal = BigDecimal.ZERO;
        BigDecimal saludMinima = new BigDecimal("100");
        int diaCritico = 0;

        for (EstadoDiario estado : historial) {
            if (estado.getEstresHidrico() != null && estado.getEstresHidrico()) diasEstresHidrico++;
            if (estado.getEstresTermico() != null && estado.getEstresTermico()) diasEstresTermico++;
            if (estado.getEstresNutricional() != null && estado.getEstresNutricional()) diasEstresNutricional++;
            if (estado.getPrecipitacionMm() != null) {
                precipitacionTotal = precipitacionTotal.add(estado.getPrecipitacionMm());
            }
            if (estado.getSaludPlanta().compareTo(saludMinima) < 0) {
                saludMinima = estado.getSaludPlanta();
                diaCritico = estado.getDia();
            }
        }

        // --- Riego total real (suma de costes de eventos de riego) ---
        BigDecimal riegoTotal = eventos.stream()
                .filter(e -> e.getTipoEvento() == Evento.TipoEvento.riego)
                .map(e -> e.getCantidad() != null ? e.getCantidad() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // --- Nutrientes usados (fertilizaciones aplicadas) ---
        long fertilizaciones = eventos.stream()
                .filter(e -> e.getTipoEvento() == Evento.TipoEvento.fertilizacion)
                .count();
        BigDecimal nitrogenoUsado = simulacion.getNitrogenoInicial()
                .add(BigDecimal.valueOf(fertilizaciones * 30));
        BigDecimal fosforoUsado = simulacion.getFosforoInicial()
                .add(BigDecimal.valueOf(fertilizaciones * 15));
        BigDecimal potasioUsado = simulacion.getPotasioInicial()
                .add(BigDecimal.valueOf(fertilizaciones * 20));

        // --- Rendimiento basado en salud y etapa alcanzada ---
        double[] cultivoInfo = CULTIVO_DATA.getOrDefault(simulacion.getTipoCultivo(), new double[]{4000, 0.30});
        double rendimientoPotencial = cultivoInfo[0];
        double precioKg = cultivoInfo[1];

        // Factor de salud: promedio ponderado de la salud a lo largo de la simulación
        double saludPromedio = historial.isEmpty() ? simulacion.getSaludActual().doubleValue()
                : historial.stream()
                    .mapToDouble(e -> e.getSaludPlanta().doubleValue())
                    .average()
                    .orElse(50.0);
        double factorSalud = saludPromedio / 100.0;

        // Factor de etapa: cuánto del ciclo se completó
        double factorEtapa = calcularFactorEtapa(simulacion.getEtapaFenologica());

        // Factor de estrés: penalización por días acumulados de estrés
        int totalDias = Math.max(simulacion.getDiaActual(), 1);
        double ratioEstres = (double)(diasEstresHidrico + diasEstresTermico + diasEstresNutricional) / (totalDias * 3.0);
        double factorEstres = Math.max(0.2, 1.0 - ratioEstres);

        double rendimientoReal = rendimientoPotencial * factorSalud * factorEtapa * factorEstres;
        double rendimientoRelativo = (rendimientoReal / rendimientoPotencial) * 100;
        rendimientoRelativo = Math.min(100, Math.max(0, rendimientoRelativo));

        // --- Estado final ---
        Resultado.EstadoFinal estadoFinal;
        if (simulacion.getSaludActual().compareTo(BigDecimal.ZERO) <= 0) {
            estadoFinal = Resultado.EstadoFinal.fracaso_total;
        } else if (rendimientoRelativo >= 70) {
            estadoFinal = Resultado.EstadoFinal.exitoso;
        } else if (rendimientoRelativo >= 40) {
            estadoFinal = Resultado.EstadoFinal.fracaso_parcial;
        } else {
            estadoFinal = Resultado.EstadoFinal.fracaso_total;
        }

        // --- Calidad basada en rendimiento relativo ---
        Resultado.CalidadProducto calidad;
        if (rendimientoRelativo >= 85) calidad = Resultado.CalidadProducto.excelente;
        else if (rendimientoRelativo >= 65) calidad = Resultado.CalidadProducto.alta;
        else if (rendimientoRelativo >= 40) calidad = Resultado.CalidadProducto.media;
        else calidad = Resultado.CalidadProducto.baja;

        // --- Causa principal del resultado ---
        Resultado.CausaPrincipal causa = determinarCausaPrincipal(
                diasEstresHidrico, diasEstresTermico, diasEstresNutricional, eventos, rendimientoRelativo);

        // --- Economía real ---
        BigDecimal costeTotal = simulacion.getGastosTotales();
        BigDecimal superficie = simulacion.getSuperficieHectareas();
        BigDecimal ingresoEstimado = BigDecimal.valueOf(rendimientoReal)
                .multiply(BigDecimal.valueOf(precioKg))
                .multiply(superficie)
                .setScale(2, RoundingMode.HALF_UP);
        BigDecimal beneficioNeto = ingresoEstimado.subtract(costeTotal);

        // --- Crear resultado ---
        Resultado resultado = new Resultado();
        resultado.setIdSimulacion(simulacionId);
        resultado.setDiaFinalizacion(simulacion.getDiaActual());
        resultado.setEstadoFinal(estadoFinal);
        resultado.setEtapaAlcanzada(simulacion.getEtapaFenologica());

        resultado.setRendimientoKgHa(BigDecimal.valueOf(rendimientoReal).setScale(2, RoundingMode.HALF_UP));
        resultado.setRendimientoPotencial(BigDecimal.valueOf(rendimientoPotencial).setScale(2, RoundingMode.HALF_UP));
        resultado.setRendimientoRelativo(BigDecimal.valueOf(rendimientoRelativo).setScale(2, RoundingMode.HALF_UP));
        resultado.setCalidadProducto(calidad);
        resultado.setBiomasaFinal(simulacion.getAlturaActual().multiply(BigDecimal.valueOf(12)));
        resultado.setAlturaFinal(simulacion.getAlturaActual());

        resultado.setPrecipitacionTotal(precipitacionTotal.setScale(2, RoundingMode.HALF_UP));
        resultado.setRiegoTotal(riegoTotal.setScale(2, RoundingMode.HALF_UP));
        resultado.setDiasEstresHidrico(diasEstresHidrico);
        resultado.setEficienciaUsoAgua(
                rendimientoReal > 0 && precipitacionTotal.add(riegoTotal).compareTo(BigDecimal.ZERO) > 0
                ? BigDecimal.valueOf(rendimientoReal)
                    .divide(precipitacionTotal.add(riegoTotal), 3, RoundingMode.HALF_UP)
                : BigDecimal.ZERO
        );

        resultado.setNitrogenoUsado(nitrogenoUsado);
        resultado.setFosforoUsado(fosforoUsado);
        resultado.setPotasioUsado(potasioUsado);
        resultado.setDiasEstresTermico(diasEstresTermico);
        resultado.setDiasEstresNutricional(diasEstresNutricional);

        resultado.setCausaPrincipal(causa);
        resultado.setDiaCritico(diaCritico > 0 ? diaCritico : null);

        resultado.setCosteTotal(costeTotal);
        resultado.setIngresoEstimado(ingresoEstimado);
        resultado.setBeneficioNeto(beneficioNeto);

        return resultadoRepository.save(resultado);
    }

    private double calcularFactorEtapa(EtapaFenologica etapa) {
        switch (etapa) {
            case germinacion:    return 0.0;
            case emergencia:     return 0.05;
            case vegetativo:     return 0.25;
            case floracion:      return 0.50;
            case fructificacion: return 0.75;
            case maduracion:     return 0.95;
            case cosecha:        return 1.0;
            default:             return 0.5;
        }
    }

    private boolean esPlagaOEnfermedad(Evento.TipoEvento tipo) {
        switch (tipo) {
            case plaga:
            case enfermedad:
            case roya:
            case mildiu:
            case oidio:
            case virus_mosaico:
            case pulgones:
            case arana_roja:
            case caracoles:
            case nematodos:
            case langostas:
            case marabunta_hormigas:
                return true;
            default:
                return false;
        }
    }

    private Resultado.CausaPrincipal determinarCausaPrincipal(
            int diasHidrico, int diasTermico, int diasNutricional,
            List<Evento> eventos, double rendimientoRelativo) {

        if (rendimientoRelativo >= 70) return Resultado.CausaPrincipal.ninguna;

        // Contar eventos negativos por tipo (clásicos + nuevos)
        long plagas = eventos.stream().filter(e ->
                e.getTipoEvento() == Evento.TipoEvento.plaga ||
                e.getTipoEvento() == Evento.TipoEvento.pulgones ||
                e.getTipoEvento() == Evento.TipoEvento.arana_roja ||
                e.getTipoEvento() == Evento.TipoEvento.caracoles ||
                e.getTipoEvento() == Evento.TipoEvento.nematodos ||
                e.getTipoEvento() == Evento.TipoEvento.aves_plaga ||
                e.getTipoEvento() == Evento.TipoEvento.jabalies ||
                e.getTipoEvento() == Evento.TipoEvento.langostas ||
                e.getTipoEvento() == Evento.TipoEvento.marabunta_hormigas).count();
        long enfermedades = eventos.stream().filter(e ->
                e.getTipoEvento() == Evento.TipoEvento.enfermedad ||
                e.getTipoEvento() == Evento.TipoEvento.roya ||
                e.getTipoEvento() == Evento.TipoEvento.mildiu ||
                e.getTipoEvento() == Evento.TipoEvento.oidio ||
                e.getTipoEvento() == Evento.TipoEvento.virus_mosaico).count();
        long sequias = eventos.stream().filter(e ->
                e.getTipoEvento() == Evento.TipoEvento.sequia ||
                e.getTipoEvento() == Evento.TipoEvento.apagon_riego).count();
        long heladas = eventos.stream().filter(e ->
                e.getTipoEvento() == Evento.TipoEvento.helada ||
                e.getTipoEvento() == Evento.TipoEvento.nevada).count();
        long olasCalor = eventos.stream().filter(e ->
                e.getTipoEvento() == Evento.TipoEvento.ola_calor ||
                e.getTipoEvento() == Evento.TipoEvento.incendio_proximo ||
                e.getTipoEvento() == Evento.TipoEvento.ola_radiacion_uv).count();

        // Determinar la causa dominante
        Map<Resultado.CausaPrincipal, Integer> pesos = new HashMap<>();
        pesos.put(Resultado.CausaPrincipal.sequia, diasHidrico * 2 + (int) sequias * 5);
        pesos.put(Resultado.CausaPrincipal.calor_extremo, (int) olasCalor * 5 + (diasTermico > diasHidrico ? diasTermico : 0));
        pesos.put(Resultado.CausaPrincipal.helada, (int) heladas * 5);
        pesos.put(Resultado.CausaPrincipal.deficiencia_nutrientes, diasNutricional * 2);
        pesos.put(Resultado.CausaPrincipal.plaga, (int) plagas * 5);
        pesos.put(Resultado.CausaPrincipal.enfermedad, (int) enfermedades * 5);

        return pesos.entrySet().stream()
                .max(Comparator.comparingInt(Map.Entry::getValue))
                .filter(e -> e.getValue() > 0)
                .map(Map.Entry::getKey)
                .orElse(Resultado.CausaPrincipal.manejo_inadecuado);
    }

    public Resultado obtenerResultado(Long simulacionId, Long userId) {
        obtenerSimulacionPorId(simulacionId, userId); // Verificar permisos
        return resultadoRepository.findByIdSimulacion(simulacionId)
                .orElseThrow(() -> new RuntimeException("Resultado no encontrado"));
    }

    public List<Resultado> obtenerResultadosUsuario(Long userId) {
        return resultadoRepository.findAllByUsuarioId(userId);
    }

    @Transactional
    public Simulacion actualizarSimulacion(Long simulacionId, Simulacion simulacionActualizada, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);

        // Actualizar campos permitidos
        if (simulacionActualizada.getNombreSimulacion() != null) {
            simulacion.setNombreSimulacion(simulacionActualizada.getNombreSimulacion());
        }
        if (simulacionActualizada.getTipoCultivo() != null) {
            simulacion.setTipoCultivo(simulacionActualizada.getTipoCultivo());
        }
        if (simulacionActualizada.getSuperficieHectareas() != null) {
            simulacion.setSuperficieHectareas(simulacionActualizada.getSuperficieHectareas());
        }
        if (simulacionActualizada.getEventosAleatorios() != null) {
            simulacion.setEventosAleatorios(simulacionActualizada.getEventosAleatorios());
        }

        return simulacionRepository.save(simulacion);
    }

    @Transactional
    public Simulacion setEventosAleatorios(Long simulacionId, boolean activos, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        simulacion.setEventosAleatorios(activos);
        return simulacionRepository.save(simulacion);
    }

    @Transactional
    public Simulacion setModoInvencible(Long simulacionId, boolean activo, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        simulacion.setModoInvencible(activo);
        if (activo) {
            simulacion.setSaludActual(new BigDecimal("100.00"));
        }
        return simulacionRepository.save(simulacion);
    }

    /**
     * Establece la lista (CSV) de tipos de evento permitidos como aleatorios.
     * Si la cadena es null, vacía o se le pasa "*" se interpreta como
     * "todos los eventos permitidos" (= comportamiento por defecto).
     */
    @Transactional
    public Simulacion setEventosPermitidos(Long simulacionId, String csv, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        if (csv == null || csv.trim().isEmpty() || "*".equals(csv.trim())) {
            simulacion.setEventosPermitidos(null);
        } else {
            // Limpieza básica: quitar espacios y duplicados manteniendo orden.
            String[] partes = csv.split(",");
            java.util.LinkedHashSet<String> set = new java.util.LinkedHashSet<>();
            for (String p : partes) {
                String trimmed = p.trim();
                if (!trimmed.isEmpty()) set.add(trimmed);
            }
            simulacion.setEventosPermitidos(String.join(",", set));
        }
        return simulacionRepository.save(simulacion);
    }

    @Transactional
    public void eliminarSimulacion(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        simulacionRepository.delete(simulacion);
    }

    /**
     * Mapea cada tipo de evento del usuario a la categoría de gasto que se muestra
     * en el panel de economía y el gráfico de pastel. Mantener alineado con las
     * categorías inicializadas en obtenerEstadisticasEconomicas().
     */
    private String categoriaDeGasto(Evento.TipoEvento tipo) {
        switch (tipo) {
            case riego:
                return "Riego";
            case fertilizacion:
                return "Fertilización";
            case tratamiento_fitosanitario:
            case control_biologico:
                return "Tratamientos Fitosanitarios";
            case poda:
                return "Poda y Mantenimiento";
            case mulching:
            case compostaje:
            case aireacion_suelo:
            case enmienda_calcica:
                return "Manejo del Suelo";
            case instalacion_malla:
                return "Infraestructura";
            default:
                return "Otros";
        }
    }

    public EstadisticasEconomicasDTO obtenerEstadisticasEconomicas(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        List<Evento> eventos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacionId);

        // Agrupar gastos por categoría. Mantenemos un orden de inserción estable
        // para que el panel de economía pinte siempre las mismas etiquetas en el
        // mismo orden, independientemente de qué acciones haya hecho el usuario.
        Map<String, BigDecimal> gastosPorCategoria = new java.util.LinkedHashMap<>();
        gastosPorCategoria.put("Riego", BigDecimal.ZERO);
        gastosPorCategoria.put("Fertilización", BigDecimal.ZERO);
        gastosPorCategoria.put("Tratamientos Fitosanitarios", BigDecimal.ZERO);
        gastosPorCategoria.put("Poda y Mantenimiento", BigDecimal.ZERO);
        gastosPorCategoria.put("Manejo del Suelo", BigDecimal.ZERO);
        gastosPorCategoria.put("Infraestructura", BigDecimal.ZERO);
        gastosPorCategoria.put("Otros", BigDecimal.ZERO);

        for (Evento evento : eventos) {
            if (evento.getCosteEuros() == null || evento.getCosteEuros().compareTo(BigDecimal.ZERO) <= 0) continue;

            String categoria = categoriaDeGasto(evento.getTipoEvento());
            gastosPorCategoria.merge(categoria, evento.getCosteEuros(), BigDecimal::add);
        }

        BigDecimal balance = simulacion.getPresupuestoActual()
            .subtract(simulacion.getPresupuestoInicial())
            .add(simulacion.getIngresosEstimados());

        return new EstadisticasEconomicasDTO(
            simulacion.getPresupuestoInicial(),
            simulacion.getPresupuestoActual(),
            simulacion.getGastosTotales(),
            simulacion.getIngresosEstimados(),
            balance,
            gastosPorCategoria
        );
    }
}
