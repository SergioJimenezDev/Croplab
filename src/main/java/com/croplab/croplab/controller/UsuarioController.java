package com.croplab.croplab.controller;

import com.croplab.croplab.dto.ApiResponse;
import com.croplab.croplab.dto.EstadisticasUsuarioDTO;
import com.croplab.croplab.dto.UsuarioDTO;
import com.croplab.croplab.security.UserPrincipal;
import com.croplab.croplab.service.UsuarioService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/usuarios")
@RequiredArgsConstructor
public class UsuarioController {

    private final UsuarioService usuarioService;

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<UsuarioDTO>> obtenerUsuario(@PathVariable Long id) {
        try {
            UsuarioDTO usuario = usuarioService.obtenerUsuarioPorId(id);
            return ResponseEntity.ok(ApiResponse.success(usuario));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UsuarioDTO>> obtenerUsuarioActual(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            UsuarioDTO usuario = usuarioService.obtenerUsuarioPorId(userPrincipal.getId());
            return ResponseEntity.ok(ApiResponse.success(usuario));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<UsuarioDTO>> actualizarUsuario(
            @PathVariable Long id,
            @RequestBody UsuarioDTO usuarioDTO,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            if (!id.equals(userPrincipal.getId())) {
                return ResponseEntity.status(403)
                        .body(ApiResponse.error("No tienes permiso para actualizar este usuario"));
            }

            UsuarioDTO actualizado = usuarioService.actualizarUsuario(id, usuarioDTO);
            return ResponseEntity.ok(ApiResponse.success("Usuario actualizado exitosamente", actualizado));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/{id}/cambiar-contrasena")
    public ResponseEntity<ApiResponse<Void>> cambiarContrasena(
            @PathVariable Long id,
            @RequestBody Map<String, String> request,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            if (!id.equals(userPrincipal.getId())) {
                return ResponseEntity.status(403)
                        .body(ApiResponse.error("No tienes permiso para cambiar esta contraseña"));
            }

            String contrasenaActual = request.get("contrasenaActual");
            String contrasenaNueva = request.get("contrasenaNueva");

            usuarioService.cambiarContrasena(id, contrasenaActual, contrasenaNueva);
            return ResponseEntity.ok(ApiResponse.success("Contraseña cambiada exitosamente", null));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{id}/estadisticas")
    public ResponseEntity<ApiResponse<EstadisticasUsuarioDTO>> obtenerEstadisticas(
            @PathVariable Long id,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {
        try {
            if (!id.equals(userPrincipal.getId())) {
                return ResponseEntity.status(403)
                        .body(ApiResponse.error("No tienes permiso para ver estas estadísticas"));
            }

            EstadisticasUsuarioDTO estadisticas = usuarioService.obtenerEstadisticas(id);
            return ResponseEntity.ok(ApiResponse.success(estadisticas));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }
}
