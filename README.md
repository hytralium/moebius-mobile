# Moebius Web

Web-Version des Modellbildungsprogramms **Moebius** („**Mo**delle **e**infach **bi**lden **u**nd **s**imulieren“), das im Physikunterricht in Sachsen eingesetzt wird. Läuft im Browser auf PC, Tablet und Handy – ohne Installation, ohne Server, ohne Build-Schritt.

## Starten

`index.html` über einen beliebigen Webserver ausliefern, z. B.

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

(GitHub Pages funktioniert ebenso.) Nach dem ersten Laden ist die App offline nutzbar.

## Bedienung wie im Original

| Original | Moebius Web |
|---|---|
| Eingabemaske: „Wiederhole … mal“, „Name der Simulation“, Gleichungsfeld, Startwerte-Tabelle, „Groß-, Kleinschreibung“, OK / Abbrechen / Hilfe | gleich (Knopf **Eingabe** oder F2) |
| Startwerte erscheinen automatisch für alle Größen, die gelesen werden, bevor sie berechnet werden | gleich |
| Seitenleiste: Name der Simulation, 3-dimensional, getrennte Schaubilder, x-Achse, y-Achse (Mehrfachauswahl) | gleich |
| Rechner-Knopf: Wiederholungen verdoppeln | gleich |
| „Klicken Sie auf die Kurve oder Achse, die bearbeitet werden soll.“ | Kurve → Farbe/Stärke/Linienart, Achse → Min/Max/Teilung |
| Textwerkzeug mit F / K / U, x², x₂, Größe, Schriftart | gleich |
| Mehrere Simulationen pro Datei, Kurven als `v [Name]` | gleich |
| Tabellenansicht, Drucken | gleich, zusätzlich CSV- und PNG-Export |
| `.prg`-Dateien | **können geöffnet werden** (Gleichungen, Startwerte, Wiederholungen, gewählte y-Größen) |

### Schreibweise der Gleichungen

```
A=pi/4*d^2
F_LW=1/2*c_W*roh_Luft*A*v^2
a=(F_G-F_LW)/m
if s<=1000 then A=A+0,01; c_W=c_W+0,005
v=v+a*dt
s=s+v*dt: t=t+dt
```

- Eine Anweisung pro Zeile; mehrere mit `:` oder `;` trennen.
- `if … then …` gilt bis zum Zeilenende (optional `else`).
- Dezimalkomma oder -punkt, Exponent `1E-5`.
- `+ - * / ^`, `sin cos tan arcsin arccos arctan exp ln sqr sqrt abs` (Winkel im Bogenmaß).
- Keine eingebauten Konstanten – `pi`, `e`, `g` sind Startwerte.
- Gerechnet wird wie im Original: alle Größen starten mit 0 bzw. ihrem Startwert, je Durchlauf werden alle Zeilen von oben nach unten ausgeführt und danach die Werte gespeichert (der erste gespeicherte Wert ist also nach dem 1. Durchlauf).

## Grenzen / Unterschiede

- **Grafisches Modell**: zeigt nur eine aus den Gleichungen erzeugte Übersicht (Einfluss-, Zwischen-, Zustandsgrößen); grafisches Modellieren per Maus ist nicht umgesetzt.
- **Speichern** erfolgt als `.json`. Original-`.prg`-Dateien werden nur gelesen; das Binärformat ist nicht dokumentiert und wurde an Beispieldateien ermittelt. Kurvenfarben, Texte und Achseneinstellungen aus `.prg` werden nicht übernommen.
- Bei sehr vielen Durchläufen (> 25 Mio. gespeicherte Werte) wird für die Anzeige jeder n-te Wert gespeichert.

## Dateien

- `index.html`, `css/style.css` – Oberfläche
- `js/parser.js` – Gleichungs-Parser (ohne `eval`)
- `js/prg.js` – Import von Moebius-`.prg`-Dateien
- `js/app.js` – Simulation, Schaubild, Tabelle, Dialoge
- `js/examples.js` – eigene Beispielmodelle (Datei → Beispiele)

Eigenständige Neuentwicklung, nicht mit dem Originalprogramm verbunden.
