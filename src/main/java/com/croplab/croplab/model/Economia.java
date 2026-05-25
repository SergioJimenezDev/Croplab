package com.croplab.croplab.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Entity
@Table(name = "economia")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Economia {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_economia")
    private Long idEconomia;

    @Column(name = "id_simulacion", nullable = false, unique = true)
    private Long idSimulacion;

    @Column(name = "coste_semillas", precision = 8, scale = 2)
    private BigDecimal costeSemillas = BigDecimal.ZERO;

    @Column(name = "coste_fertilizantes", precision = 8, scale = 2)
    private BigDecimal costeFertilizantes = BigDecimal.ZERO;

    @Column(name = "coste_riego", precision = 8, scale = 2)
    private BigDecimal costeRiego = BigDecimal.ZERO;

    @Column(name = "coste_tratamientos", precision = 8, scale = 2)
    private BigDecimal costeTratamientos = BigDecimal.ZERO;

    @Column(name = "coste_mano_obra", precision = 8, scale = 2)
    private BigDecimal costeManoObra = BigDecimal.ZERO;

    @Column(name = "coste_maquinaria", precision = 8, scale = 2)
    private BigDecimal costeMaquinaria = BigDecimal.ZERO;

    @Column(name = "otros_costes", precision = 8, scale = 2)
    private BigDecimal otrosCostes = BigDecimal.ZERO;

    @Column(name = "precio_venta_kg", precision = 6, scale = 2)
    private BigDecimal precioVentaKg = BigDecimal.ZERO;

    @Column(name = "ingreso_estimado", precision = 10, scale = 2)
    private BigDecimal ingresoEstimado = BigDecimal.ZERO;

    @Column(name = "rentabilidad_porcentaje", precision = 6, scale = 2)
    private BigDecimal rentabilidadPorcentaje;

    // Método para calcular el coste total
    public BigDecimal getCosteTotal() {
        return costeSemillas
                .add(costeFertilizantes)
                .add(costeRiego)
                .add(costeTratamientos)
                .add(costeManoObra)
                .add(costeMaquinaria)
                .add(otrosCostes);
    }

    // Método para calcular el beneficio neto
    public BigDecimal getBeneficioNeto() {
        return ingresoEstimado.subtract(getCosteTotal());
    }
}
