package com.croplab.croplab.repository;

import com.croplab.croplab.model.EstadoDiario;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface EstadoDiarioRepository extends JpaRepository<EstadoDiario, Long> {

    List<EstadoDiario> findByIdSimulacionOrderByDiaAsc(Long idSimulacion);

    Optional<EstadoDiario> findByIdSimulacionAndDia(Long idSimulacion, Integer dia);

    long countByIdSimulacion(Long idSimulacion);
}
