package com.croplab.croplab.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "usuario")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Usuario {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id_usuario")
    private Long idUsuario;

    @NotBlank(message = "El nombre es requerido")
    @Column(nullable = false, length = 100)
    private String nombre;

    @NotBlank(message = "El email es requerido")
    @Email(message = "Email no válido")
    @Column(nullable = false, unique = true, length = 150)
    private String email;

    @NotBlank(message = "La contraseña es requerida")
    @Column(nullable = false)
    private String contrasena;

    @Column(name = "fecha_registro", updatable = false)
    private LocalDateTime fechaRegistro;

    @Column(name = "fecha_ultimo_acceso")
    private LocalDateTime fechaUltimoAcceso;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Rol rol = Rol.estudiante;

    @Column(length = 200)
    private String institucion;

    public enum Rol {
        estudiante, profesor, investigador, agricultor
    }

    @PrePersist
    protected void onCreate() {
        fechaRegistro = LocalDateTime.now();
        fechaUltimoAcceso = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        fechaUltimoAcceso = LocalDateTime.now();
    }
}
