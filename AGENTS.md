# Pitayas Media – pobieranie filmów i muzyki na komputerze (+ moduł na telefon)

> Plik przekazania projektu między narzędziami AI (Claude Code ⇄ Antigravity ⇄ inne).
> Przeczytaj go w całości, zanim cokolwiek zmienisz. **Nie ma tu żadnych sekretów** – hasła i klucze są poza repozytorium i nie wolno ich kopiować do kodu, logów ani rozmów.
> Stan na: 2026-10-29. Jeśli zmieniasz architekturę albo sposób wdrażania, zaktualizuj ten plik.

## 1. Czym to jest
**Pitayas Media** pobiera filmy i muzykę na komputerze: YouTube i ok. 1800 stron (yt-dlp), zwykłe linki (także debrid z Pitaya Streams) i torrenty. Moduł **Pitayas Media** w aplikacji Pitayas zleca pobieranie z telefonu przez sieć lokalną i pobiera gotowy plik na telefon.

## 2. Zasady od właściciela
- Pobrane pliki domyślnie w `~/Pobrane/Pitayas Media` (do zmiany w ustawieniach).
- Serwer dla telefonu jest w sieci lokalnej — nie wystawiaj go do internetu.

## 3. Gdzie co leży i jak uruchamiać
`npm install`, `npm start`. Paczki: `npm run build:win`, `build:linux`, `build:all`. Wydania robi Pitayas Admin.

## 4. Struktura
```
main.js       okno, tray, ustawienia (port 8193, katalog, format, jakość)
engine.js     zadania pobierania: yt-dlp, zwykłe linki, torrenty
server.js     API dla telefonu: GET /info, POST /api/analyze, GET/POST /api/jobs, POST /api/jobs/<id>/cancel, DELETE /api/jobs/<id>, GET /files/<id> (Range)
renderer.js, index.html   okno
```

## 5. Testowanie
Serwer i silnik można uruchomić bez okna; testuj `curl`-em na lokalnym porcie. Prawdziwe pobieranie wymaga internetu i yt-dlp.

## 6. Zasady wspólne
- **Język:** interfejs, komentarze, opisy zmian i odpowiedzi po polsku. Marka „Pitayas”; kolory: róż pitai `#ff4fa6`, ciemne tło `#121116`.
- **Wygląd:** matowy, spokojny, czytelny — **nie „AI slop”**: bez świecących gradientów w tytułach, poświat pod przyciskami i udawanego szkła w CSS. Prawdziwe szkło tylko natywne (iOS 26) na elementach, które się nie ruszają.
- **Pitaya Core:** folder `core/` w aplikacji to **kopia** z projektu `Pitayas-Core`. Nie edytuj jej w aplikacji — zmieniaj w `Pitayas-Core` i uruchom `~/Pitayas-Projects/ADMIN/sync-core.sh`. Każda aplikacja rejestruje się w `~/.config/Pitayas/apps/<id>.json` i wystawia kanał sterowania (kontrakt Core 0.2, dla przyszłego Pitaya Hub).
- **Lista zmian:** po **każdej** zmianie w aplikacji dopisz wpis: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis po polsku"`. `<id>` = nazwa folderu bez „Pitayas-”, małymi literami (np. `screen`, `mobile`, `accounts`, `admin`, `website`). Wpisy trafiają do opisu wydania na GitHubie.
- **Git:** commity jako właściciel (`Pitayas <inbox@rakunek.com>`), krótki opis po polsku, **bez** `Co-Authored-By` i wzmianek o narzędziach AI. Push tylko na bieżącą gałąź, bez force-push bez zgody.
- **Budowanie i wydania:** nie buduj, nie pakuj i nie publikuj wersji bez wyraźnej prośby właściciela. Wydania robi **Pitayas Admin** (`ADMIN/cli.js`, GitHub Releases organizacji Pitayas-Team). Po budowie nie uruchamiaj aplikacji właściciela.
- **Sekrety:** hasła, tokeny, klucze i pliki `.env` nigdy do kodu, logów, commitów ani rozmów.
- **Uczciwość:** nie masz telefonu, iPhone'a ani Windowsa — wyraźnie napisz, czego nie dało się sprawdzić, zamiast twierdzić, że działa.
- **Praca na serwerze:** projekty leżą w `~/Pitayas-Projects` na serwerze rakunek.com (kopia na komputerze właściciela to zapas). Nie startuj zbędnych procesów w tle ani dodatkowych sesji/agentów.
