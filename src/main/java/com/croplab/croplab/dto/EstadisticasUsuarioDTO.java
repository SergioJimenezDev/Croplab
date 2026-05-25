package com.croplab.croplab.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class EstadisticasUsuarioDTO {
    private Long totalSimulaciones;
    private Long completadas;
    private Long fallidas;
    private Long enCurso;
    private Double saludPromedio;
}
