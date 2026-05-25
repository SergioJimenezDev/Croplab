package com.croplab.croplab.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class EstadisticasEconomicasDTO {
    private BigDecimal presupuestoInicial;
    private BigDecimal presupuestoActual;
    private BigDecimal gastosTotales;
    private BigDecimal ingresosEstimados;
    private BigDecimal balanceActual;
    private Map<String, BigDecimal> gastosPorCategoria;
}
