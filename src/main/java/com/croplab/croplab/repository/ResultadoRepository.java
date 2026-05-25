package com.croplab.croplab.repository;

import com.croplab.croplab.model.Resultado;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ResultadoRepository extends JpaRepository<Resultado, Long> {

    Optional<Resultado> findByIdSimulacion(Long idSimulacion);

    boolean existsByIdSimulacion(Long idSimulacion);

    @Query("SELECT r FROM Resultado r WHERE r.idSimulacion IN " +
           "(SELECT s.idSimulacion FROM Simulacion s WHERE s.idUsuario = :userId AND s.estado = 'completada') " +
           "ORDER BY r.fechaFinalizacion DESC")
    List<Resultado> findAllByUsuarioId(Long userId);
}
