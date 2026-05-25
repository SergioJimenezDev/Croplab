package com.croplab.croplab.controller;

import com.croplab.croplab.dto.*;
import com.croplab.croplab.model.Usuario;
import com.croplab.croplab.security.JwtTokenProvider;
import com.croplab.croplab.service.UsuarioService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final UsuarioService usuarioService;
    private final JwtTokenProvider tokenProvider;

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthResponse>> register(@Valid @RequestBody RegisterRequest request) {
        try {
            Usuario usuario = usuarioService.registrarUsuario(request);
            String token = tokenProvider.generateTokenFromUserId(usuario.getIdUsuario());

            AuthResponse authResponse = new AuthResponse(
                    token,
                    UsuarioDTO.fromEntity(usuario)
            );

            return ResponseEntity.ok(ApiResponse.success("Usuario registrado exitosamente", authResponse));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@Valid @RequestBody LoginRequest request) {
        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(
                            request.getEmail(),
                            request.getContrasena()
                    )
            );

            SecurityContextHolder.getContext().setAuthentication(authentication);
            String token = tokenProvider.generateToken(authentication);

            UsuarioDTO usuarioDTO = usuarioService.obtenerUsuarioPorEmail(request.getEmail());
            AuthResponse authResponse = new AuthResponse(token, usuarioDTO);

            return ResponseEntity.ok(ApiResponse.success("Inicio de sesión exitoso", authResponse));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Credenciales inválidas"));
        }
    }
}
