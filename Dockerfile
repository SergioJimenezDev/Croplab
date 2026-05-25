# ===== STAGE 1: build con Maven =====
FROM maven:3.9.9-eclipse-temurin-17 AS builder
WORKDIR /app

# Cachear dependencias (capa separada)
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

# Copiar fuentes y empaquetar
COPY src ./src
RUN mvn -B -q clean package -DskipTests

# ===== STAGE 2: runtime JRE ligero =====
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

COPY --from=builder /app/target/*.jar app.jar

# Render asigna el puerto vía la env var PORT; Spring lo leerá desde application.properties
ENV JAVA_OPTS="-Xms256m -Xmx450m"
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
