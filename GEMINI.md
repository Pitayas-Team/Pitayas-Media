# Instrukcje dla Antigravity / Gemini

Cały kontekst projektu **Pitayas Media** (cel, zasady od właściciela, struktura, uruchamianie i wdrażanie, testowanie, znane ograniczenia) jest w pliku **`AGENTS.md`** w tym samym katalogu – przeczytaj go najpierw i traktuj jako obowiązujący.

Najważniejsze w skrócie:
- Electron + serwer dla telefonu (`server.js`, domyślnie port 8193): analiza linków (yt-dlp), zadania pobierania, plik z obsługą Range.
- yt-dlp pobiera się sam przy pierwszym użyciu, ffmpeg jest w paczce.
- Po stronie telefonu to moduł `media` w `Pitayas-Mobile` (dostęp „tylko dla testerów” z serwera kont).
- Wszystko po polsku; wygląd matowy i spokojny, nie „AI slop”.
- Po każdej zmianie dopisz wpis w liście zmian: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis"`.
- Commity jako właściciel, **bez** „Co-Authored-By” i wzmianek o AI. Nie buduj ani nie publikuj wersji bez prośby.
- Nigdy nie kopiuj sekretów (hasła, tokeny, `.env`) do kodu, logów ani czatu. Napisz, czego nie mogłeś sprawdzić.
