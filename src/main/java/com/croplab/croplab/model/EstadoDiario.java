package com.croplab.croplab.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "estado_diario")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EstadoDiario {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_estado")
    private Long idEstado;

    @Column(name = "id_simulacion", nullable = false)
    private Long idSimulacion;

    @Column(nullable = false)
    private Integer dia;

    @Column(name = "fecha_simulada", nullable = false)
    private LocalDate fechaSimulada;

    // Estado de la planta
    @Column(name = "salud_planta", nullable = false, precision = 5, scale = 2)
    private BigDecimal saludPlanta;

    @Column(name = "altura_cm", nullable = false, precision = 6, scale = 2)
    private BigDecimal alturaCm;

    @Column(name = "biomasa_kg_ha", precision = 8, scale = 2)
    private BigDecimal biomasaKgHa;

    @Column(name = "indice_area_foliar", precision = 4, scale = 2)
    private BigDecimal indiceAreaFoliar;

    @Enumerated(EnumType.STRING)
    @Column(name = "etapa_fenologica", nullable = false)
    private EtapaFenologica etapaFenologica;

    // Condiciones ambientales
    @Column(name = "humedad_suelo", nullable = false, precision = 5, scale = 2)
    private BigDecimal humedadSuelo;

    @Column(nullable = false, precision = 4, scale = 2)
    private BigDecimal temperatura;

    @Column(name = "precipitacion_mm", precision = 6, scale = 2)
    private BigDecimal precipitacionMm = BigDecimal.ZERO;

    @Column(name = "radiacion_solar", precision = 5, scale = 2)
    private BigDecimal radiacionSolar;

    // Nutrientes disponibles
    @Column(name = "nitrogeno_disponible", precision = 6, scale = 2)
    private BigDecimal nitrogenoDisponible;

    @Column(name = "fosforo_disponible", precision = 6, scale = 2)
    private BigDecimal fosforoDisponible;

    @Column(name = "potasio_disponible", precision = 6, scale = 2)
    private BigDecimal potasioDisponible;

    // Indicadores de estrés
    @Column(name = "estres_hidrico", nullable = false)
    private Boolean estresHidrico = false;

    @Column(name = "estres_termico", nullable = false)
    private Boolean estresTermico = false;

    @Column(name = "estres_nutricional", nullable = false)
    private Boolean estresNutricional = false;
}
