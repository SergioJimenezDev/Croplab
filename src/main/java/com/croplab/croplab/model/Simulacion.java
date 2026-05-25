package com.croplab.croplab.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "simulacion")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Simulacion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_simulacion")
    private Long idSimulacion;

    @Column(name = "id_usuario", nullable = false)
    private Long idUsuario;

    // Información básica
    @NotBlank(message = "El nombre de la simulación es requerido")
    @Column(name = "nombre_simulacion", nullable = false, length = 200)
    private String nombreSimulacion;

    @Column(name = "fecha_creacion", updatable = false)
    private LocalDateTime fechaCreacion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Estado estado = Estado.en_curso;

    @Min(value = 1, message = "El día actual debe ser mayor a 0")
    @Column(name = "dia_actual", nullable = false)
    private Integer diaActual = 1;

    // Configuración del terreno
    @DecimalMin(value = "0.01", message = "La superficie debe ser mayor a 0")
    @DecimalMax(value = "10.00", message = "La superficie no puede exceder 10 hectáreas")
    @Column(name = "superficie_hectareas", nullable = false, precision = 6, scale = 2)
    private BigDecimal superficieHectareas;

    @Enumerated(EnumType.STRING)
    @Column(name = "tipo_suelo", nullable = false)
    private TipoSuelo tipoSuelo;

    @DecimalMin(value = "4.5")
    @DecimalMax(value = "8.5")
    @Column(name = "ph_suelo", nullable = false, precision = 3, scale = 1)
    private BigDecimal phSuelo;

    @Column(name = "materia_organica", precision = 4, scale = 2)
    private BigDecimal materiaOrganica;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Drenaje drenaje = Drenaje.bueno;

    @Enumerated(EnumType.STRING)
    @Column(name = "capacidad_retencion_agua", nullable = false)
    private CapacidadRetencionAgua capacidadRetencionAgua = CapacidadRetencionAgua.media;

    // Nutrientes iniciales (kg/ha)
    @Column(name = "nitrogeno_inicial", nullable = false, precision = 6, scale = 2)
    private BigDecimal nitrogenoInicial = BigDecimal.ZERO;

    @Column(name = "fosforo_inicial", nullable = false, precision = 6, scale = 2)
    private BigDecimal fosforoInicial = BigDecimal.ZERO;

    @Column(name = "potasio_inicial", nullable = false, precision = 6, scale = 2)
    private BigDecimal potasioInicial = BigDecimal.ZERO;

    // Configuración climática
    @Enumerated(EnumType.STRING)
    @Column(name = "region_climatica", nullable = false)
    private RegionClimatica regionClimatica;

    @Column(name = "temperatura_media", nullable = false, precision = 4, scale = 2)
    private BigDecimal temperaturaMedia;

    @Column(name = "precipitacion_anual", nullable = false, precision = 7, scale = 2)
    private BigDecimal precipitacionAnual;

    // Cultivo seleccionado
    @Enumerated(EnumType.STRING)
    @Column(name = "tipo_cultivo", nullable = false)
    private TipoCultivo tipoCultivo;

    @Column(name = "fecha_siembra", nullable = false)
    private LocalDate fechaSiembra;

    @Column(name = "densidad_siembra", nullable = false, precision = 6, scale = 2)
    private BigDecimal densidadSiembra;

    @Enumerated(EnumType.STRING)
    @Column(name = "sistema_riego", nullable = false)
    private SistemaRiego sistemaRiego = SistemaRiego.goteo;

    // Estado actual del cultivo
    @Enumerated(EnumType.STRING)
    @Column(name = "etapa_fenologica", nullable = false)
    private EtapaFenologica etapaFenologica = EtapaFenologica.germinacion;

    @DecimalMin("0.0")
    @DecimalMax("100.0")
    @Column(name = "salud_actual", precision = 5, scale = 2)
    private BigDecimal saludActual = new BigDecimal("100.0");

    @Column(name = "altura_actual", precision = 6, scale = 2)
    private BigDecimal alturaActual = BigDecimal.ZERO;

    @DecimalMin("0.0")
    @DecimalMax("100.0")
    @Column(name = "humedad_suelo_actual", precision = 5, scale = 2)
    private BigDecimal humedadSueloActual = new BigDecimal("50.0");

    // Economía
    @Column(name = "presupuesto_inicial", precision = 10, scale = 2)
    private BigDecimal presupuestoInicial = new BigDecimal("10000.0");

    @Column(name = "presupuesto_actual", precision = 10, scale = 2)
    private BigDecimal presupuestoActual = new BigDecimal("10000.0");

    @Column(name = "gastos_totales", precision = 10, scale = 2)
    private BigDecimal gastosTotales = BigDecimal.ZERO;

    @Column(name = "ingresos_estimados", precision = 10, scale = 2)
    private BigDecimal ingresosEstimados = BigDecimal.ZERO;

    // Configuración de gameplay
    @Column(name = "eventos_aleatorios")
    private Boolean eventosAleatorios = true;

    @Column(name = "modo_invencible")
    private Boolean modoInvencible = false;

    // Enums
    public enum Estado {
        en_curso, completada, fallida, pausada
    }

    public enum TipoSuelo {
        arenoso, franco_arenoso, franco, franco_arcilloso, arcilloso
    }

    public enum Drenaje {
        malo, regular, bueno, excelente
    }

    public enum CapacidadRetencionAgua {
        baja, media, alta
    }

    public enum RegionClimatica {
        mediterraneo, continental, atlantico, subtropical
    }

    public enum TipoCultivo {
        trigo, maiz, arroz, cebada,
        tomate, lechuga, pimiento, zanahoria,
        judia, guisante, soja,
        girasol, colza, vid, olivo
    }

    public enum SistemaRiego {
        ninguno, goteo, aspersion, inundacion
    }

    @PrePersist
    protected void onCreate() {
        fechaCreacion = LocalDateTime.now();
    }
}
