package com.croplab.croplab.dto;

import com.croplab.croplab.model.Usuario;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UsuarioDTO {
    private Long idUsuario;
    private String nombre;
    private String email;
    private LocalDateTime fechaRegistro;
    private LocalDateTime fechaUltimoAcceso;
    private Usuario.Rol rol;
    private String institucion;

    public static UsuarioDTO fromEntity(Usuario usuario) {
        return new UsuarioDTO(
                usuario.getIdUsuario(),
                usuario.getNombre(),
                usuario.getEmail(),
                usuario.getFechaRegistro(),
                usuario.getFechaUltimoAcceso(),
                usuario.getRol(),
                usuario.getInstitucion()
        );
    }
}
