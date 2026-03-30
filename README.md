# INEM Centro — Isócronas de Emergência

Mapa interativo das bases de emergência do INEM na Região Centro de Portugal, com isócronas de cobertura, pesquisa por morada/código postal e cálculo de tempos de resposta (ETAs).

## Funcionalidades

- **Bases INEM** — AEM (10), SIV (17), VMER+HIDRC (14) com marcadores e popups
- **Hospitais** — 18 unidades (SUP, SUMC, SUB) com markers
- **Isócronas** — cobertura ≤30' (verde) e >30' (vermelho) via OpenRouteService
- **Pesquisa** — moradas, códigos postais (offline, ~197K registos CTT), coordenadas GPS
- **ETAs** — cálculo via grid pré-calculado + ORS Matrix API, fator 1.3× (emergência)
- **Rotas** — traçado via ORS Directions API com rota de emergência
- **Dark theme** — mapa OSM com filtro CSS, interface completa dark

## Motor de dados

| Função | Serviço |
|--------|---------|
| Isócronas | OpenRouteService v2 |
| ETAs (matrix) | ORS Matrix API |
| Rotas | ORS Directions API |
| Geocodificação | Photon (Komoot) + Nominatim fallback |
| Códigos postais | Base CTT offline (postal.js ~7.4MB) |
| ETAs offline | Grid pré-calculado OSRM (grid_etas.js) |

## Estrutura

```
├── index.html          — UI principal
├── style.css           — Dark theme, Leaflet customizations
├── app.js              — Lógica da aplicação
├── data.js             — Isócronas GeoJSON geradas via ORS
├── postal.js           — Base de dados CTT ~197K registos
├── postal_cp4.js       — Índice CP4 para pesquisa rápida
├── grid_etas.js        — ETAs pré-calculados (OSRM, ~13K destinos × 59 origens)
└── regenerate_isochrones.py — Script para regenerar data.js
```

## Regenerar isócronas

```bash
python3 regenerate_isochrones.py
```

Requer acesso à ORS API (chave incluída no script). Demora ~7 minutos.

## Velocidade de emergência

Todas as isócronas e ETAs usam um fator de **1.3×** sobre a velocidade de condução normal, representando condução de emergência com sinalização luminosa e sonora.

- Isócrona ≤30' emergência = 2340s tempo normal (30 × 60 × 1.3)
- Isócrona ≤30' (máx ORS) = 3600s tempo normal (≈46' emergência)

## Bases de dados

### AEM (10 bases)
AEANADIA, AEAVEIRO, AECBR1/AECBR3, AECBR2, AEFIGFOZ, AEFUNDAO, AELEIRIA, AEVISEU1, AEVISEU2/AEVISEU3, AEMCOVILHA

### SIV (17 bases)
SIAGUEDA, SIALCOBC, SIARGANIL, SIAVELAR, SICANTND, SIPENICH, SIPOMBAL, SISEIA, SISPSUL, SITONDLA, SIOZEMS, SILAMEGO, SIMOIMEN, SIVNFCOA, SITOMAR, SITNOVAS, SIMIRA

### VMER (14 bases, inclui HIDRC)
VMAVEIRO, VMCRAINH, VMCBRANC, VMCHC, VMFIGFOZ, VMCOVILHA, VMGUARDA, VMLEIRIA, VMVISEU, VMHUC, VMFEIRA, VMMTJ, VMTVDRS, **HIDRC**

---

*App 100% client-side, sem backend.*
