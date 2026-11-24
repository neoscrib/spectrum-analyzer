package main

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Fixed catalog allowlist; no user-supplied upstream URL or credentials.
func tleHandler(client *http.Client) http.HandlerFunc {
	type entry struct {
		text string
		at   time.Time
	}
	var lock sync.Mutex
	cache := map[string]entry{}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			http.Error(w, "Use GET.", http.StatusMethodNotAllowed)
			return
		}
		id := r.URL.Query().Get("id")
		if id != "59051" && id != "57166" && id != "40069" && id != "44387" {
			http.Error(w, "Unsupported satellite catalog number.", http.StatusBadRequest)
			return
		}
		lock.Lock()
		defer lock.Unlock()
		if saved, ok := cache[id]; ok && time.Since(saved.at) < time.Hour {
			_, _ = io.WriteString(w, saved.text)
			return
		}
		request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://celestrak.org/NORAD/elements/gp.php?CATNR="+id+"&FORMAT=TLE", nil)
		if err != nil {
			http.Error(w, "TLE lookup failed.", http.StatusBadGateway)
			return
		}
		response, err := client.Do(request)
		if err != nil {
			http.Error(w, "CelesTrak is unavailable. Paste a TLE to work offline.", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		text, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		if err != nil || response.StatusCode != http.StatusOK || len(text) > 4096 || !strings.Contains(string(text), "1 "+id) || !strings.Contains(string(text), "2 "+id) {
			http.Error(w, "No matching TLE returned by CelesTrak.", http.StatusBadGateway)
			return
		}
		cache[id] = entry{string(text), time.Now()}
		_, _ = w.Write(text)
	}
}
