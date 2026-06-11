# Skill: Issue Tracker

## Propósito

Registrar incidentes, problemas o bugs del proyecto ONPE Elecciones 2026 con un formato estandarizado que documenta: qué pasó, qué se analizó y cómo se resolvió.

## Cuándo usar este skill

- Cuando el usuario reporta que algo "está caído" o "no funciona"
- Cuando se encuentra un bug o error en producción
- Cuando se necesita documentar un incidente con su análisis y resolución
- Cuando el usuario dice algo como "registra este problema", "crea un issue", "documenta lo que pasó"

## Formato del archivo de issue

Cada issue se guarda en la carpeta `Issues/` con el formato:
```
Issues/YYYY-MM-DD_titulo-corto.md
```

### Plantilla del issue

```markdown
# Issue #XXX — [Título corto del problema]

**Fecha:** YYYY-MM-DD  
**Hora de inicio:** HH:MM UTC  
**Hora de resolución:** HH:MM UTC (o "Pendiente")  
**Duración total:** X horas X minutos (o "En curso")  
**Severidad:** Alta / Media / Baja  
**Estado:** RESUELTO / EN CURSO / ABIERTO

---

## 1. ¿Qué sucedió?

[Descripción clara del problema desde la perspectiva del usuario. ¿Qué veía? ¿Qué esperaba ver? ¿Cuándo empezó?]

### Síntomas reportados
- [Lista de síntomas concretos]

### Lo que el usuario veía
```
[Copia de pantalla o descripción visual del error]
```

---

## 2. ¿Qué se analizó?

### 2.1 Verificación de servicios
| Servicio | Estado | Detalle |
|----------|--------|---------|
| [Servicio 1] | ✅/❌ | [Detalle] |

### 2.2 Logs y errores encontrados
```
[Logs relevantes del error]
```

> **Explicación para dummies:** [Explicar qué significa este error en lenguaje simple, con analogías cotidianas]

### 2.3 Pruebas realizadas
| Prueba | Resultado |
|--------|-----------|
| [Prueba 1] | [Resultado] |

### 2.4 Causa raíz identificada
[Explicación técnica de qué causó exactamente el problema]

> **Explicación para dummies:** [Analogía simple para entender el problema]

---

## 3. ¿Cómo se resolvió?

### Cambios técnicos realizados

**1. [Nombre del cambio]:**
```javascript
// ANTES:
[código original]

// DESPUÉS:
[código corregido]
```
> **Para dummies:** [Qué hace este cambio en lenguaje simple]

### Archivos modificados
| Archivo | Cambio |
|---------|--------|
| [archivo] | [descripción] |

---

## 4. Prevención futura
- [Qué se hizo para que no vuelva a pasar]

---

## 5. Lecciones aprendidas
1. [Lección 1]
2. [Lección 2]
```

## Proceso para crear un issue

1. **Preguntar al usuario** qué pasó (si no está claro)
2. **Investigar** logs, estado de servicios, código
3. **Identificar** la causa raíz
4. **Resolver** el problema
5. **Documentar** usando la plantilla anterior
6. **Guardar** en `Issues/YYYY-MM-DD_titulo.md`
7. **Informar** al usuario con un resumen corto

## Ejemplo de invocación

Usuario: "la web está caída, revisa qué pasa"

1. Verificar servicios (Firebase, Cloud Run, Firestore)
2. Revisar logs de Cloud Run
3. Analizar el código
4. Encontrar la causa raíz
5. Implementar la corrección
6. Desplegar
7. Verificar que funciona
8. Crear el issue documentando todo el proceso
9. Dar resumen al usuario
