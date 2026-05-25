package com.croplab.croplab.repository;

import com.croplab.croplab.model.Economia;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface EconomiaRepository extends JpaRepository<Economia, Long> {

    Optional<Economia> findByIdSimulacion(Long idSimulacion);

    boolean existsByIdSimulacion(Long idSimulacion);
}
