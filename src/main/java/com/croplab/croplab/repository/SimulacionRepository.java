package com.croplab.croplab.repository;

import com.croplab.croplab.model.Simulacion;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SimulacionRepository extends JpaRepository<Simulacion, Long> {

    Page<Simulacion> findByIdUsuario(Long idUsuario, Pageable pageable);

    List<Simulacion> findByIdUsuario(Long idUsuario);

    List<Simulacion> findByIdUsuarioAndEstado(Long idUsuario, Simulacion.Estado estado);

    long countByIdUsuario(Long idUsuario);

    long countByIdUsuarioAndEstado(Long idUsuario, Simulacion.Estado estado);

    @Query("SELECT AVG(s.saludActual) FROM Simulacion s WHERE s.idUsuario = :idUsuario AND s.estado = 'completada'")
    Double findAverageSaludByIdUsuario(Long idUsuario);

    @Query("SELECT AVG(s.saludActual) FROM Simulacion s WHERE s.idUsuario = :idUsuario")
    Double averageSaludActualByIdUsuario(Long idUsuario);
}
