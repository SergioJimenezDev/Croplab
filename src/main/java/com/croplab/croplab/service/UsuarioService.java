package com.croplab.croplab.service;

import com.croplab.croplab.dto.EstadisticasUsuarioDTO;
import com.croplab.croplab.dto.RegisterRequest;
import com.croplab.croplab.dto.UsuarioDTO;
import com.croplab.croplab.model.Simulacion;
import com.croplab.croplab.model.Usuario;
import com.croplab.croplab.repository.SimulacionRepository;
import com.croplab.croplab.repository.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UsuarioService {

    private final UsuarioRepository usuarioRepository;
    private final SimulacionRepository simulacionRepository;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public Usuario registrarUsuario(RegisterRequest request) {
        if (usuarioRepository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("El email ya está registrado");
        }

        Usuario usuario = new Usuario();
        usuario.setNombre(request.getNombre());
        usuario.setEmail(request.getEmail());
        usuario.setContrasena(passwordEncoder.encode(request.getContrasena()));
        usuario.setRol(request.getRol() != null ? request.getRol() : Usuario.Rol.estudiante);
        usuario.setInstitucion(request.getInstitucion());

        return usuarioRepository.save(usuario);
    }

    public UsuarioDTO obtenerUsuarioPorId(Long id) {
        Usuario usuario = usuarioRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));
        return UsuarioDTO.fromEntity(usuario);
    }

    public UsuarioDTO obtenerUsuarioPorEmail(String email) {
        Usuario usuario = usuarioRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));
        return UsuarioDTO.fromEntity(usuario);
    }

    @Transactional
    public UsuarioDTO actualizarUsuario(Long id, UsuarioDTO usuarioDTO) {
        Usuario usuario = usuarioRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        if (usuarioDTO.getNombre() != null) {
            usuario.setNombre(usuarioDTO.getNombre());
        }
        if (usuarioDTO.getInstitucion() != null) {
            usuario.setInstitucion(usuarioDTO.getInstitucion());
        }

        Usuario actualizado = usuarioRepository.save(usuario);
        return UsuarioDTO.fromEntity(actualizado);
    }

    @Transactional
    public void cambiarContrasena(Long id, String contrasenaActual, String contrasenaNueva) {
        Usuario usuario = usuarioRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        if (!passwordEncoder.matches(contrasenaActual, usuario.getContrasena())) {
            throw new RuntimeException("La contraseña actual es incorrecta");
        }

        usuario.setContrasena(passwordEncoder.encode(contrasenaNueva));
        usuarioRepository.save(usuario);
    }

    public EstadisticasUsuarioDTO obtenerEstadisticas(Long userId) {
        Long total = simulacionRepository.countByIdUsuario(userId);
        Long completadas = simulacionRepository.countByIdUsuarioAndEstado(userId, Simulacion.Estado.completada);
        Long fallidas = simulacionRepository.countByIdUsuarioAndEstado(userId, Simulacion.Estado.fallida);
        Long enCurso = simulacionRepository.countByIdUsuarioAndEstado(userId, Simulacion.Estado.en_curso);
        Double saludPromedio = simulacionRepository.averageSaludActualByIdUsuario(userId);

        return new EstadisticasUsuarioDTO(
            total,
            completadas,
            fallidas,
            enCurso,
            saludPromedio != null ? saludPromedio : 0.0
        );
    }
}
