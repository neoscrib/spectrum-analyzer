package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const tleCacheDuration = 2 * time.Hour
const tleRetryDelay = 15 * time.Minute

// Fixed catalog/provider allowlists; no user-supplied upstream URL or credentials.
func tleHandler(client *http.Client) http.HandlerFunc {
	return newTLEHandler(client, time.Now)
}

func newTLEHandler(client *http.Client, now func() time.Time) http.HandlerFunc {
	type entry struct {
		text, source string
		at           time.Time
	}
	type provider struct {
		name, prefix, suffix string
		retryAt              time.Time
		failure              string
	}
	providers := []provider{
		{name: "CelesTrak", prefix: "https://celestrak.org/NORAD/elements/gp.php?CATNR=", suffix: "&FORMAT=TLE"},
		{name: "SatNOGS", prefix: "https://db.satnogs.org/api/tle/?norad_cat_id=", suffix: "&format=json"},
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
		serve := func(saved entry) {
			w.Header().Set("X-TLE-Source", saved.source)
			_, _ = io.WriteString(w, saved.text)
		}
		if saved, ok := cache[id]; ok && now().Sub(saved.at) < tleCacheDuration {
			if _, err := validateTLE(saved.text, id, now()); err == nil {
				serve(saved)
				return
			}
		}
		var failures []string
		for i := range providers {
			p := &providers[i]
			if now().Before(p.retryAt) {
				failures = append(failures, p.failure)
				continue
			}
			text, err := fetchTLE(r.Context(), client, p.prefix+id+p.suffix, p.name, id, now())
			if r.Context().Err() != nil {
				return
			}
			if err != nil {
				p.failure = p.name + " " + err.Error()
				// Share provider cooldown across catalog IDs. CelesTrak asks
				// clients to stop all queries for at least 15 minutes after 5xx.
				p.retryAt = now().Add(tleRetryDelay)
				failures = append(failures, p.failure)
				log.Printf("TLE refresh for %s: %s", id, p.failure)
				continue
			}
			saved := entry{text: text, source: p.name, at: now()}
			cache[id] = saved
			serve(saved)
			return
		}
		w.Header().Set("Retry-After", "900")
		http.Error(w, "TLE refresh unavailable: "+strings.Join(failures, "; ")+". Your existing elements are unchanged. Try again later or paste a TLE.", http.StatusBadGateway)
	}
}

func fetchTLE(ctx context.Context, client *http.Client, url, source, id string, now time.Time) (string, error) {
	// Both providers fit inside the server's 25-second response timeout.
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", errors.New("request failed")
	}
	response, err := client.Do(request)
	if err != nil {
		return "", errors.New("is unreachable or timed out")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8193))
	if err != nil || len(body) > 8192 {
		return "", errors.New("returned an invalid response")
	}
	text := string(body)
	if source == "SatNOGS" {
		var rows []struct {
			ID   int    `json:"norad_cat_id"`
			Name string `json:"tle0"`
			One  string `json:"tle1"`
			Two  string `json:"tle2"`
		}
		if json.Unmarshal(body, &rows) != nil || len(rows) != 1 || strconv.Itoa(rows[0].ID) != id {
			return "", errors.New("returned no matching TLE")
		}
		text = strings.TrimPrefix(rows[0].Name, "0 ") + "\n" + rows[0].One + "\n" + rows[0].Two
	}
	return validateTLE(text, id, now)
}

func validateTLE(text, id string, now time.Time) (string, error) {
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n")), "\n")
	start := 0
	if len(lines) == 3 {
		start = 1
	} else if len(lines) != 2 {
		return "", errors.New("returned no matching TLE")
	}
	for n := 0; n < 2; n++ {
		line := lines[start+n]
		if len(line) != 69 || !strings.HasPrefix(line, strconv.Itoa(n+1)+" "+id) {
			return "", errors.New("returned an invalid or mismatched TLE")
		}
		sum := 0
		for _, c := range line[:68] {
			if c >= '0' && c <= '9' {
				sum += int(c - '0')
			} else if c == '-' {
				sum++
			}
		}
		if line[68] < '0' || line[68] > '9' || sum%10 != int(line[68]-'0') {
			return "", errors.New("returned a TLE with an invalid checksum")
		}
	}
	one := lines[start]
	year, yearErr := strconv.Atoi(one[18:20])
	day, dayErr := strconv.ParseFloat(strings.TrimSpace(one[20:32]), 64)
	if year < 57 {
		year += 2000
	} else {
		year += 1900
	}
	jan := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	days := jan.AddDate(1, 0, 0).Sub(jan).Hours() / 24
	if yearErr != nil || dayErr != nil || !(day >= 1 && day < days+1) {
		return "", errors.New("returned a TLE with an invalid epoch")
	}
	epoch := jan.Add(time.Duration((day - 1) * float64(24*time.Hour)))
	if age := now.Sub(epoch); age > 14*24*time.Hour || age < -14*24*time.Hour {
		return "", errors.New("returned a TLE more than 14 days from today")
	}
	return strings.Join(lines, "\n") + "\n", nil
}
