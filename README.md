# War is War

Shooter 3D de hordas (Three.js) sobre un puente entre las nubes. Tu pelotón dispara
automáticamente mientras cientos de enemigos avanzan hacia ti.

**Jugar:** https://fpsoto.github.io/war-is-war/

## Etapas

1. 100 soldados en formación.
2. 500 soldados de pared a pared.
3. 500 soldados y un gigante en el centro.

## Power-ups

Los carteles de los bordes avanzan desde el fondo. Dispárales hasta vaciar su barra:

- **+1 SOLDADO** — se une otro soldado al pelotón (máx. 8, se conservan entre etapas).
- **x2 CADENCIA** — doble cadencia de disparo durante 8 s.
- **+30 VIDA** — recupera vida.
- **PERFORA** — las balas atraviesan hasta 4 enemigos durante 6 s.

## Controles

- Arrastra (ratón o dedo) o usa ◀ ▶ / A D para moverte. El disparo es automático.
- `?level=2` o `?level=3` en la URL salta a esa etapa.

## Ejecutar en local

Los módulos ES necesitan un servidor:

```
npx serve .
```

No hay paso de build: Three.js se carga desde jsDelivr mediante un import map.
La dificultad se ajusta en `LEVELS` y `POWERUPS` al principio de `game.js`.
