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

        simulacionRepository.save(simulacion);

        return estadoDiario;
    }

    private EstadoDiario calcularEstadoDiario(Simulacion simulacion) {
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
        // Verificar si ha habido fertilización en los últimos 15 días
        List<Evento> fertilizaciones = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacion.getIdSimulacion())
                .stream()
                .filter(e -> e.getTipoEvento() == Evento.TipoEvento.fertilizacion)
                .filter(e -> e.getDiaEvento() >= simulacion.getDiaActual() - 15)
                .toList();

        if (fertilizaciones.isEmpty() && simulacion.getDiaActual() > 15) {
            penalizacionTotal += 2 + random.nextDouble() * 4; // -2 a -6
            estresNutricional = true;
        }

        // 4. NECESIDAD DE RIEGO (verificar riegos recientes)
        List<Evento> riegos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacion.getIdSimulacion())
                .stream()
                .filter(e -> e.getTipoEvento() == Evento.TipoEvento.riego)
                .filter(e -> e.getDiaEvento() >= simulacion.getDiaActual() - 3)
                .toList();

        if (riegos.isEmpty() && humedadActual.compareTo(BigDecimal.valueOf(50)) < 0) {
            penalizacionTotal += 3 + random.nextDouble() * 5; // -3 a -8
        }

        // 5. EVENTOS NEGATIVOS PREVIOS (plagas, enfermedades, plagas específicas)
        List<Evento> eventosNegativos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacion.getIdSimulacion())
                .stream()
                .filter(e -> esPlagaOEnfermedad(e.getTipoEvento()))
                .filter(e -> e.getDiaEvento() >= simulacion.getDiaActual() - 10)
                .toList();

        for (Evento evento : eventosNegativos) {
            // Verificar si hubo tratamiento o control biológico después
            List<Evento> tratamientos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacion.getIdSimulacion())
                    .stream()
                    .filter(e -> e.getTipoEvento() == Evento.TipoEvento.tratamiento_fitosanitario ||
                                 e.getTipoEvento() == Evento.TipoEvento.control_biologico)
                    .filter(e -> e.getDiaEvento() > evento.getDiaEvento() && e.getDiaEvento() <= simulacion.getDiaActual())
                    .toList();

            if (tratamientos.isEmpty()) {
                // No hubo tratamiento, la plaga/enfermedad sigue activa
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

        Evento.TipoEvento tipo = pool[random.nextInt(pool.length)];
        evento.setTipoEvento(tipo);
        evento.setDescripcion(descripcionPorDefecto(tipo));
        evento.setIntensidad(intensidadPorDefecto(tipo));

        eventoRepository.save(evento);
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

    private Evento.Intensidad intensidadPorDefecto(Evento.TipoEvento tipo) {
        switch (tipo) {
            // Catástrofes graves
            case terremoto:
            case tornado:
            case granizo:
            case rayo_caido:
            case incendio_proximo:
            case langostas:
            case jabalies:
            case virus_mosaico:
            case contaminacion_quimica:
                return Evento.Intensidad.severo;

            // Problemas medios
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
                return Evento.Intensidad.moderado;

            // Eventos leves
            case viento_fuerte:
            case lluvia_torrencial:
            case malas_hierbas:
            case niebla_persistente:
            case polvo_sahariano:
            case lluvia_acida:
            case caracoles:
            case aves_plaga:
            case ola_radiacion_uv:
                return Evento.Intensidad.leve;

            default:
                return random.nextBoolean() ? Evento.Intensidad.moderado : Evento.Intensidad.severo;
        }
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

    private void aplicarEfectosEvento(Simulacion simulacion, Evento evento) {
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
                // Reducir salud MUCHO según intensidad
                int reduccionPlaga = evento.getIntensidad() == Evento.Intensidad.critico ? 35 :
                                    evento.getIntensidad() == Evento.Intensidad.severo ? 25 :
                                    evento.getIntensidad() == Evento.Intensidad.moderado ? 15 : 8;
                BigDecimal saludPlaga = simulacion.getSaludActual().subtract(BigDecimal.valueOf(reduccionPlaga));
                simulacion.setSaludActual(saludPlaga.max(BigDecimal.ZERO));
                break;

            case enfermedad:
                // Reducir salud MUY SEVERAMENTE según intensidad
                int reduccionEnfermedad = evento.getIntensidad() == Evento.Intensidad.critico ? 40 :
                                         evento.getIntensidad() == Evento.Intensidad.severo ? 30 :
                                         evento.getIntensidad() == Evento.Intensidad.moderado ? 18 : 10;
                BigDecimal saludEnfermedad = simulacion.getSaludActual().subtract(BigDecimal.valueOf(reduccionEnfermedad));
                simulacion.setSaludActual(saludEnfermedad.max(BigDecimal.ZERO));
                break;

            case malas_hierbas:
                // Reducir salud y nutrientes
                BigDecimal saludMalasHierbas = simulacion.getSaludActual().subtract(BigDecimal.valueOf(8));
                simulacion.setSaludActual(saludMalasHierbas.max(BigDecimal.ZERO));
                break;

            case sequia:
                // Reducir humedad DRÁSTICAMENTE
                BigDecimal humedadSequia = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(45));
                simulacion.setHumedadSueloActual(humedadSequia.max(BigDecimal.ZERO));
                // También reduce salud
                BigDecimal saludSequia = simulacion.getSaludActual().subtract(BigDecimal.valueOf(15));
                simulacion.setSaludActual(saludSequia.max(BigDecimal.ZERO));
                break;

            case helada:
                // Daño severo por frío
                BigDecimal saludHelada = simulacion.getSaludActual().subtract(BigDecimal.valueOf(25));
                simulacion.setSaludActual(saludHelada.max(BigDecimal.ZERO));
                break;

            case ola_calor:
                // Reducir humedad y salud
                BigDecimal humedadCalor = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(30));
                simulacion.setHumedadSueloActual(humedadCalor.max(BigDecimal.ZERO));
                BigDecimal saludCalor = simulacion.getSaludActual().subtract(BigDecimal.valueOf(12));
                simulacion.setSaludActual(saludCalor.max(BigDecimal.ZERO));
                break;

            case lluvia_torrencial:
                // Aumentar humedad al máximo pero puede dañar
                simulacion.setHumedadSueloActual(BigDecimal.valueOf(100));
                // Daño leve por exceso de agua
                BigDecimal saludLluvia = simulacion.getSaludActual().subtract(BigDecimal.valueOf(5));
                simulacion.setSaludActual(saludLluvia.max(BigDecimal.ZERO));
                break;

            case granizo:
                // Daño MUY severo por granizo
                BigDecimal saludGranizo = simulacion.getSaludActual().subtract(BigDecimal.valueOf(35));
                simulacion.setSaludActual(saludGranizo.max(BigDecimal.ZERO));
                break;

            case viento_fuerte:
                // Daño moderado
                BigDecimal saludViento = simulacion.getSaludActual().subtract(BigDecimal.valueOf(10));
                simulacion.setSaludActual(saludViento.max(BigDecimal.ZERO));
                break;

            // ================= NUEVOS EVENTOS CATASTRÓFICOS =================
            case terremoto: {
                // Agrieta el suelo: pierde humedad y daña raíces
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(18));
                BigDecimal h = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(15));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                simulacion.setHumedadSueloActual(h.max(BigDecimal.ZERO));
                break;
            }
            case tornado: {
                // Daño físico severo: salud y altura
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(30));
                BigDecimal a = simulacion.getAlturaActual().multiply(BigDecimal.valueOf(0.7));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                simulacion.setAlturaActual(a);
                break;
            }
            case inundacion: {
                // Suelo saturado, raíces ahogadas
                simulacion.setHumedadSueloActual(BigDecimal.valueOf(100));
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(20));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case nevada: {
                // Frío + peso de la nieve
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(18));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case rayo_caido: {
                // Daño puntual fuerte
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(15));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case incendio_proximo: {
                // Calor extremo + cenizas: reseca y daña
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(25));
                BigDecimal h = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(25));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                simulacion.setHumedadSueloActual(h.max(BigDecimal.ZERO));
                break;
            }
            case niebla_persistente: {
                // Reduce fotosíntesis: daño leve sostenido
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(5));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case polvo_sahariano: {
                // Polvo cubre hojas, reduce fotosíntesis
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(7));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case lluvia_acida: {
                // Quema follaje y acidifica suelo
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }

            // ================= PROBLEMAS DEL SUELO =================
            case erosion_suelo: {
                // Pérdida de capa fértil: daño nutricional + ligera salud
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case salinizacion: {
                // Sales bloquean absorción de agua
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(12));
                BigDecimal h = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                simulacion.setHumedadSueloActual(h.max(BigDecimal.ZERO));
                break;
            }
            case acidificacion_suelo: {
                // pH bajo limita absorción de nutrientes
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(10));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }

            // ================= PLAGAS Y ENFERMEDADES ESPECÍFICAS =================
            case roya:
            case mildiu:
            case oidio: {
                // Hongos: similar a enfermedad, escala según intensidad
                int red = evento.getIntensidad() == Evento.Intensidad.critico ? 28 :
                          evento.getIntensidad() == Evento.Intensidad.severo ? 20 :
                          evento.getIntensidad() == Evento.Intensidad.moderado ? 13 : 7;
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(red));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case virus_mosaico: {
                // Virus: daño fuerte y sostenido, sin cura inmediata (mitigable)
                int red = evento.getIntensidad() == Evento.Intensidad.critico ? 32 :
                          evento.getIntensidad() == Evento.Intensidad.severo ? 22 :
                          evento.getIntensidad() == Evento.Intensidad.moderado ? 15 : 8;
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(red));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case pulgones:
            case arana_roja: {
                // Plagas chupadoras
                int red = evento.getIntensidad() == Evento.Intensidad.critico ? 22 :
                          evento.getIntensidad() == Evento.Intensidad.severo ? 16 :
                          evento.getIntensidad() == Evento.Intensidad.moderado ? 10 : 6;
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(red));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case caracoles: {
                // Plaga lenta, daño moderado
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(8));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case nematodos: {
                // Daño radicular
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(15));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case aves_plaga: {
                // Picotean frutos
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(8));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case jabalies: {
                // Destrozan terreno y altura
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(22));
                BigDecimal a = simulacion.getAlturaActual().multiply(BigDecimal.valueOf(0.85));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                simulacion.setAlturaActual(a);
                break;
            }
            case langostas: {
                // Devastador
                int red = evento.getIntensidad() == Evento.Intensidad.critico ? 45 :
                          evento.getIntensidad() == Evento.Intensidad.severo ? 35 :
                          evento.getIntensidad() == Evento.Intensidad.moderado ? 25 : 15;
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(red));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }

            // ================= EVENTOS TÉCNICOS / SUBREALISTAS =================
            case apagon_riego: {
                // El sistema de riego no funciona: se pierde humedad rápido
                BigDecimal h = simulacion.getHumedadSueloActual().subtract(BigDecimal.valueOf(25));
                simulacion.setHumedadSueloActual(h.max(BigDecimal.ZERO));
                break;
            }
            case contaminacion_quimica: {
                // Vertido tóxico cercano: daño severo
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(22));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case marabunta_hormigas: {
                // Hormigas excavan y favorecen pulgones
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(9));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }
            case ola_radiacion_uv: {
                // Quemado de hojas por radiación UV anómala
                BigDecimal s = simulacion.getSaludActual().subtract(BigDecimal.valueOf(8));
                simulacion.setSaludActual(s.max(BigDecimal.ZERO));
                break;
            }

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

        simulacion.setEstado(Simulacion.Estado.completada);
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

    @Transactional
    public void eliminarSimulacion(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        simulacionRepository.delete(simulacion);
    }

    public EstadisticasEconomicasDTO obtenerEstadisticasEconomicas(Long simulacionId, Long userId) {
        Simulacion simulacion = obtenerSimulacionPorId(simulacionId, userId);
        List<Evento> eventos = eventoRepository.findByIdSimulacionOrderByDiaEventoAsc(simulacionId);

        // Agrupar gastos por categoría
        Map<String, BigDecimal> gastosPorCategoria = new HashMap<>();
        gastosPorCategoria.put("Riego", BigDecimal.ZERO);
        gastosPorCategoria.put("Fertilización", BigDecimal.ZERO);
        gastosPorCategoria.put("Tratamientos Fitosanitarios", BigDecimal.ZERO);
        gastosPorCategoria.put("Poda y Mantenimiento", BigDecimal.ZERO);
        gastosPorCategoria.put("Otros", BigDecimal.ZERO);

        for (Evento evento : eventos) {
            if (evento.getCosteEuros() != null && evento.getCosteEuros().compareTo(BigDecimal.ZERO) > 0) {
                switch (evento.getTipoEvento()) {
                    case riego:
                        gastosPorCategoria.put("Riego",
                            gastosPorCategoria.get("Riego").add(evento.getCosteEuros()));
                        break;
                    case fertilizacion:
                        gastosPorCategoria.put("Fertilización",
                            gastosPorCategoria.get("Fertilización").add(evento.getCosteEuros()));
                        break;
                    case tratamiento_fitosanitario:
                        gastosPorCategoria.put("Tratamientos Fitosanitarios",
                            gastosPorCategoria.get("Tratamientos Fitosanitarios").add(evento.getCosteEuros()));
                        break;
                    case poda:
                        gastosPorCategoria.put("Poda y Mantenimiento",
                            gastosPorCategoria.get("Poda y Mantenimiento").add(evento.getCosteEuros()));
                        break;
                    default:
                        gastosPorCategoria.put("Otros",
                            gastosPorCategoria.get("Otros").add(evento.getCosteEuros()));
                        break;
                }
            }
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
