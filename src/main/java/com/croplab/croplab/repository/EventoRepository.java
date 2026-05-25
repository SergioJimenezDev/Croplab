package com.croplab.croplab.repository;

import com.croplab.croplab.model.Evento;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface EventoRepository extends JpaRepository<Evento, Long> {

    List<Evento> findByIdSimulacionOrderByDiaEventoAsc(Long idSimulacion);

    List<Evento> findByIdSimulacionAndOrigen(Long idSimulacion, Evento.Origen origen);
}
