package com.croplab.croplab.controller;

import com.croplab.croplab.dto.ApiResponse;
import com.croplab.croplab.dto.EstadisticasEconomicasDTO;
import com.croplab.croplab.model.*;
import com.croplab.croplab.service.SimulacionService;
import com.croplab.croplab.security.UserPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/simulaciones")
@RequiredArgsConstructor
public class SimulacionController {

    private final SimulacionService simulacionService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Simulacion>>> listarSimulaciones(
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            List<Simulacion> simulaciones = simulacionService.obtenerSimulacionesPorUsuario(userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(simulaciones));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Simulacion>> obtenerSimulacion(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion simulacion = simulacionService.obtenerSimulacionPorId(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(simulacion));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Simulacion>> crearSimulacion(
            @RequestBody Simulacion simulacion,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion nuevaSimulacion = simulacionService.crearSimulacion(simulacion, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Simulación creada exitosamente", nuevaSimulacion));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/{id}/avanzar-dia")
    public ResponseEntity<ApiResponse<EstadoDiario>> avanzarDia(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            EstadoDiario nuevoEstado = simulacionService.avanzarDia(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Día avanzado exitosamente", nuevoEstado));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    /** Avanza N días en una sola transacción (mucho más rápido que N llamadas a avanzar-dia). */
    @PostMapping("/{id}/avanzar-dias")
    public ResponseEntity<ApiResponse<EstadoDiario>> avanzarVariosDias(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") int n,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            EstadoDiario ultimoEstado = simulacionService.avanzarVariosDias(id, n, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(n + " días avanzados", ultimoEstado));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}/historial")
    public ResponseEntity<ApiResponse<List<EstadoDiario>>> obtenerHistorial(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            List<EstadoDiario> historial = simulacionService.obtenerHistorial(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(historial));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}/eventos")
    public ResponseEntity<ApiResponse<List<Evento>>> obtenerEventos(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            List<Evento> eventos = simulacionService.obtenerEventos(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(eventos));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/{id}/eventos")
    public ResponseEntity<ApiResponse<Evento>> aplicarEvento(
            @PathVariable Long id,
            @RequestBody Evento evento,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Evento nuevoEvento = simulacionService.aplicarEvento(id, evento, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Evento aplicado exitosamente", nuevoEvento));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/{id}/finalizar")
    public ResponseEntity<ApiResponse<Resultado>> finalizarSimulacion(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Resultado resultado = simulacionService.finalizarSimulacion(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Simulación finalizada exitosamente", resultado));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}/resultado")
    public ResponseEntity<ApiResponse<Resultado>> obtenerResultado(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Resultado resultado = simulacionService.obtenerResultado(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(resultado));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Simulacion>> actualizarSimulacion(
            @PathVariable Long id,
            @RequestBody Simulacion simulacionActualizada,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion actualizada = simulacionService.actualizarSimulacion(id, simulacionActualizada, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Simulación actualizada exitosamente", actualizada));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PutMapping("/{id}/modo-invencible")
    public ResponseEntity<ApiResponse<Simulacion>> actualizarModoInvencible(
            @PathVariable Long id,
            @RequestParam boolean activo,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion actualizada = simulacionService.setModoInvencible(id, activo, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(
                activo ? "Modo invencible activado" : "Modo invencible desactivado",
                actualizada));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PutMapping("/{id}/dinero-infinito")
    public ResponseEntity<ApiResponse<Simulacion>> actualizarDineroInfinito(
            @PathVariable Long id,
            @RequestParam boolean activo,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion actualizada = simulacionService.setDineroInfinito(id, activo, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(
                activo ? "Dinero infinito activado" : "Dinero infinito desactivado",
                actualizada));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PutMapping("/{id}/eventos-aleatorios")
    public ResponseEntity<ApiResponse<Simulacion>> actualizarEventosAleatorios(
            @PathVariable Long id,
            @RequestParam boolean activos,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            Simulacion actualizada = simulacionService.setEventosAleatorios(id, activos, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(
                activos ? "Eventos aleatorios activados" : "Eventos aleatorios desactivados",
                actualizada));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Filtro de eventos que pueden ocurrir aleatoriamente.
     * Body: { "eventosPermitidos": "sequia,helada,plaga,..." } o null para permitir todos.
     */
    @PutMapping("/{id}/eventos-permitidos")
    public ResponseEntity<ApiResponse<Simulacion>> actualizarEventosPermitidos(
            @PathVariable Long id,
            @RequestBody(required = false) java.util.Map<String, String> body,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            String csv = body == null ? null : body.get("eventosPermitidos");
            Simulacion actualizada = simulacionService.setEventosPermitidos(id, csv, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(
                "Eventos permitidos actualizados",
                actualizada));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> eliminarSimulacion(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            simulacionService.eliminarSimulacion(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success("Simulación eliminada exitosamente", null));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/resultados/comparativa")
    public ResponseEntity<ApiResponse<List<Resultado>>> obtenerComparativa(
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            List<Resultado> resultados = simulacionService.obtenerResultadosUsuario(userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(resultados));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}/economia")
    public ResponseEntity<ApiResponse<EstadisticasEconomicasDTO>> obtenerEstadisticasEconomicas(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            EstadisticasEconomicasDTO estadisticas = simulacionService.obtenerEstadisticasEconomicas(id, userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(estadisticas));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }
}
