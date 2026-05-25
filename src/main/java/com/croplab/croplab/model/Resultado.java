package com.croplab.croplab.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "resultado")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Resultado {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_resultado")
    private Long idResultado;

    @Column(name = "id_simulacion", nullable = false, unique = true)
    private Long idSimulacion;

    @Column(name = "fecha_finalizacion")
    private LocalDateTime fechaFinalizacion;

    @Column(name = "dia_finalizacion", nullable = false)
    private Integer diaFinalizacion;

    @Enumerated(EnumType.STRING)
    @Column(name = "estado_final", nullable = false)
    private EstadoFinal estadoFinal;

    @Enumerated(EnumType.STRING)
    @Column(name = "etapa_alcanzada", nullable = false)
    private EtapaFenologica etapaAlcanzada;

    // Métricas de rendimiento
    @Column(name = "rendimiento_kg_ha", nullable = false, precision = 8, scale = 2)
    private BigDecimal rendimientoKgHa;

    @Column(name = "rendimiento_potencial", precision = 8, scale = 2)
    private BigDecimal rendimientoPotencial;

    @Column(name = "rendimiento_relativo", nullable = false, precision = 5, scale = 2)
    private BigDecimal rendimientoRelativo;

    @Enumerated(EnumType.STRING)
    @Column(name = "calidad_producto", nullable = false)
    private CalidadProducto calidadProducto;

    @Column(name = "biomasa_final", precision = 8, scale = 2)
    private BigDecimal biomasaFinal;

    @Column(name = "altura_final", precision = 6, scale = 2)
    private BigDecimal alturaFinal;

    @Column(name = "indice_area_foliar_final", precision = 4, scale = 2)
    private BigDecimal indiceAreaFoliarFinal;

    // Balance hídrico
    @Column(name = "precipitacion_total", nullable = false, precision = 7, scale = 2)
    private BigDecimal precipitacionTotal;

    @Column(name = "riego_total", nullable = false, precision = 7, scale = 2)
    private BigDecimal riegoTotal;

    @Column(name = "evapotranspiracion_real", precision = 7, scale = 2)
    private BigDecimal evapotranspiracionReal;

    @Column(name = "dias_estres_hidrico")
    private Integer diasEstresHidrico = 0;

    @Column(name = "eficiencia_uso_agua", precision = 6, scale = 3)
    private BigDecimal eficienciaUsoAgua;

    // Balance nutricional
    @Column(name = "nitrogeno_usado", nullable = false, precision = 7, scale = 2)
    private BigDecimal nitrogenoUsado;

    @Column(name = "fosforo_usado", nullable = false, precision = 7, scale = 2)
    private BigDecimal fosforoUsado;

    @Column(name = "potasio_usado", nullable = false, precision = 7, scale = 2)
    private BigDecimal potasioUsado;

    @Column(name = "dias_estres_termico")
    private Integer diasEstresTermico = 0;

    @Column(name = "dias_estres_nutricional")
    private Integer diasEstresNutricional = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "causa_principal")
    private CausaPrincipal causaPrincipal = CausaPrincipal.ninguna;

    @Column(name = "dia_critico")
    private Integer diaCritico;

    // Análisis económico
    @Column(name = "coste_total", precision = 10, scale = 2)
    private BigDecimal costeTotal = BigDecimal.ZERO;

    @Column(name = "ingreso_estimado", precision = 10, scale = 2)
    private BigDecimal ingresoEstimado = BigDecimal.ZERO;

    @Column(name = "beneficio_neto", precision = 10, scale = 2)
    private BigDecimal beneficioNeto = BigDecimal.ZERO;

    public enum EstadoFinal {
        exitoso, fracaso_parcial, fracaso_total
    }

    public enum CalidadProducto {
        baja, media, alta, excelente
    }

    public enum CausaPrincipal {
        sequia, exceso_agua, helada, calor_extremo,
        deficiencia_nutrientes, plaga, enfermedad,
        manejo_inadecuado, ninguna
    }

    @PrePersist
    protected void onCreate() {
        fechaFinalizacion = LocalDateTime.now();
    }
}
