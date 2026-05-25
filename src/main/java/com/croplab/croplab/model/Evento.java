package com.croplab.croplab.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "evento")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Evento {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_evento")
    private Long idEvento;

    @Column(name = "id_simulacion", nullable = false)
    private Long idSimulacion;

    @Column(name = "dia_evento", nullable = false)
    private Integer diaEvento;

    @Column(name = "fecha_evento")
    private LocalDateTime fechaEvento;

    @Enumerated(EnumType.STRING)
    @Column(name = "tipo_evento", nullable = false)
    private TipoEvento tipoEvento;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Origen origen;

    @Enumerated(EnumType.STRING)
    private Intensidad intensidad;

    @Column(columnDefinition = "TEXT")
    private String descripcion;

    @Column(precision = 8, scale = 2)
    private BigDecimal cantidad;

    @Column(name = "tipo_producto", length = 100)
    private String tipoProducto;

    @Column(name = "impacto_estimado", precision = 5, scale = 2)
    private BigDecimal impactoEstimado;

    @Column(name = "impacto_real", precision = 5, scale = 2)
    private BigDecimal impactoReal;

    @Column(name = "coste_euros", precision = 8, scale = 2)
    private BigDecimal costeEuros = BigDecimal.ZERO;

    public enum TipoEvento {
        // Eventos climáticos clásicos
        sequia, helada, ola_calor, lluvia_torrencial, granizo, viento_fuerte,
        // Eventos biológicos clásicos
        plaga, enfermedad, malas_hierbas,
        // Acciones de manejo clásicas
        riego, fertilizacion, tratamiento_fitosanitario, poda, cosecha, otro,

        // === Nuevos eventos catastróficos (sistema) ===
        terremoto, tornado, inundacion, nevada, rayo_caido,
        incendio_proximo, niebla_persistente, polvo_sahariano, lluvia_acida,

        // === Nuevos problemas del suelo (sistema) ===
        erosion_suelo, salinizacion, acidificacion_suelo,

        // === Nuevas plagas y enfermedades específicas (sistema) ===
        roya, mildiu, oidio, virus_mosaico,
        pulgones, arana_roja, caracoles, nematodos,
        aves_plaga, jabalies, langostas,

        // === Eventos técnicos y "subrealistas" (sistema) ===
        apagon_riego, contaminacion_quimica, marabunta_hormigas, ola_radiacion_uv,

        // === Nuevas acciones de manejo (usuario) ===
        mulching, control_biologico, enmienda_calcica,
        instalacion_malla, compostaje, aireacion_suelo
    }

    public enum Origen {
        usuario, sistema
    }

    public enum Intensidad {
        leve, moderado, severo, critico
    }

    @PrePersist
    protected void onCreate() {
        fechaEvento = LocalDateTime.now();
    }
}
