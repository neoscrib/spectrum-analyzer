package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

const tleFixture = "METEOR-M2 4\n1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998\n2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360\n"

var tleNow = time.Date(2026, 11, 25, 16, 0, 0, 0, time.UTC)

func TestTLEProxy(t *testing.T) {
	calls := 0
	body := tleFixture
	handler := newTLEHandler(clientWith(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://celestrak.org/NORAD/elements/gp.php?CATNR=59051&FORMAT=TLE" || r.Method != "GET" {
			t.Fatal(r.URL)
		}
		return reply(body), nil
	}), func() time.Time { return tleNow })
	for n := 0; n < 2; n++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 200 || w.Body.String() != body || w.Header().Get("X-TLE-Source") != "CelesTrak" {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if calls != 1 {
		t.Fatal("cache did not reuse TLE", calls)
	}
	for _, path := range []string{"/api/tle?id=1", "/api/tle?id=https://example.com", "/api/tle"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/tle?id=59051", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}
func TestTLEFailures(t *testing.T) {
	for _, body := range []string{"No GP data found", "1 57166 wrong\n2 57166 wrong", strings.Repeat(" ", 5000)} {
		handler := newTLEHandler(clientWith(func(*http.Request) (*http.Response, error) { return reply(body), nil }), func() time.Time { return tleNow })
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 502 {
			t.Fatal(w.Code)
		}
	}
	handler := newTLEHandler(clientWith(func(*http.Request) (*http.Response, error) { return nil, errors.New("network failure") }), func() time.Time { return tleNow })
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
	if w.Code != 502 {
		t.Fatal(w.Code)
	}
}

func satnogsFixture(t *testing.T) string {
	t.Helper()
	lines := strings.Split(tleFixture, "\n")
	body, err := json.Marshal([]map[string]any{{"norad_cat_id": 59051, "tle0": "0 " + lines[0], "tle1": lines[1], "tle2": lines[2]}})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestTLEFallbackAndCache(t *testing.T) {
	now := tleNow
	calls := map[string]int{}
	handler := newTLEHandler(clientWith(func(r *http.Request) (*http.Response, error) {
		calls[r.URL.Host]++
		deadline, ok := r.Context().Deadline()
		if !ok || time.Until(deadline) > 6*time.Second {
			t.Fatal("missing bounded upstream timeout")
		}
		if r.URL.Host == "celestrak.org" {
			response := reply("<html>Upstream maintenance</html>")
			response.StatusCode = 503
			return response, nil
		}
		if r.URL.String() != "https://db.satnogs.org/api/tle/?norad_cat_id=59051&format=json" {
			t.Fatal(r.URL)
		}
		return reply(satnogsFixture(t)), nil
	}), func() time.Time { return now })
	for n := 0; n < 2; n++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 200 || w.Body.String() != tleFixture || w.Header().Get("X-TLE-Source") != "SatNOGS" {
			t.Fatal(w.Code, w.Body.String(), w.Header())
		}
	}
	if calls["celestrak.org"] != 1 || calls["db.satnogs.org"] != 1 {
		t.Fatal("fallback or cache did not work", calls)
	}
	now = now.Add(tleCacheDuration)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
	if w.Code != 200 || calls["celestrak.org"] != 2 || calls["db.satnogs.org"] != 2 {
		t.Fatal("cache did not expire", w.Code, calls)
	}
}

func TestTLEOutageCooldownAndRecovery(t *testing.T) {
	now := tleNow
	calls, recovering := 0, false
	handler := newTLEHandler(clientWith(func(r *http.Request) (*http.Response, error) {
		calls++
		if recovering {
			return reply(tleFixture), nil
		}
		response := reply("<html>Do not display upstream HTML</html>")
		response.StatusCode = 503
		return response, nil
	}), func() time.Time { return now })
	for _, id := range []string{"59051", "57166", "40069", "44387"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id="+id, nil))
		if w.Code != 502 || !strings.Contains(w.Body.String(), "CelesTrak returned HTTP 503; SatNOGS returned HTTP 503") || strings.Contains(w.Body.String(), "<html>") || w.Header().Get("Retry-After") != "900" {
			t.Fatal(w.Code, w.Body.String(), w.Header())
		}
	}
	if calls != 2 {
		t.Fatal("outage cooldown must cover all satellite IDs", calls)
	}
	now = now.Add(tleRetryDelay)
	recovering = true
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
	if w.Code != 200 || calls != 3 || w.Body.String() != tleFixture {
		t.Fatal("did not recover after cooldown", w.Code, calls, w.Body.String())
	}
}

func TestTLEValidation(t *testing.T) {
	for _, body := range []string{
		strings.Replace(tleFixture, "9998", "9999", 1),
		strings.ReplaceAll(tleFixture, "59051", "57166"),
		tleFixture[:len(tleFixture)-3],
		"<html>1 59051\n2 59051</html>",
	} {
		if _, err := validateTLE(body, "59051", tleNow); err == nil {
			t.Fatal("accepted invalid TLE", body)
		}
	}
	for _, now := range []time.Time{tleNow.AddDate(0, 0, 30), tleNow.AddDate(0, 0, -30)} {
		if _, err := validateTLE(tleFixture, "59051", now); err == nil {
			t.Fatal("accepted stale/future TLE")
		}
	}
	if text, err := validateTLE(strings.ReplaceAll(tleFixture, "\n", "\r\n"), "59051", tleNow); err != nil || text != tleFixture {
		t.Fatal("failed to normalize CRLF", text, err)
	}
}

func TestTLEInvalidFallback(t *testing.T) {
	for _, body := range []string{
		"[]", "{}", "not json", strings.Repeat(" ", 8193),
		strings.Replace(satnogsFixture(t), `"norad_cat_id":59051`, `"norad_cat_id":57166`, 1),
		strings.Replace(satnogsFixture(t), "9998", "9999", 1),
	} {
		handler := newTLEHandler(clientWith(func(r *http.Request) (*http.Response, error) {
			if r.URL.Host == "celestrak.org" {
				return nil, errors.New("unavailable")
			}
			return reply(body), nil
		}), func() time.Time { return tleNow })
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 502 {
			t.Fatal("accepted invalid fallback", w.Code, body)
		}
	}
}

func TestTLECancellationDoesNotDisableProvider(t *testing.T) {
	calls := 0
	handler := newTLEHandler(clientWith(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Context().Err() != nil {
			return nil, r.Context().Err()
		}
		return reply(tleFixture), nil
	}), func() time.Time { return tleNow })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/tle?id=59051", nil).WithContext(ctx))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
	if w.Code != 200 || w.Header().Get("X-TLE-Source") != "CelesTrak" || calls != 2 {
		t.Fatal("client cancellation incorrectly disabled provider", w.Code, calls)
	}
}

func TestTLELiveSatNOGSFallback(t *testing.T) {
	if os.Getenv("TLE_LIVE_TESTS") != "1" {
		t.Skip("Set TLE_LIVE_TESTS=1 to contact SatNOGS")
	}
	// Exercise the real fallback API without retrying an overloaded CelesTrak.
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "celestrak.org" {
			response := reply("Simulated primary outage")
			response.StatusCode = 503
			return response, nil
		}
		return http.DefaultTransport.RoundTrip(r)
	})}
	handler := newHandler("", client)
	for _, id := range []string{"59051", "57166"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id="+id, nil))
		if w.Code != 200 || w.Header().Get("X-TLE-Source") != "SatNOGS" {
			t.Fatal(w.Code, w.Body.String())
		}
		if _, err := validateTLE(w.Body.String(), id, time.Now()); err != nil {
			t.Fatal(err)
		}
		t.Logf("Live fallback %s: %s", id, w.Body.String())
	}
}
