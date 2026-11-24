package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTLEProxy(t *testing.T) {
	calls := 0
	body := "METEOR-M2 4\n1 59051 test\n2 59051 test\n"
	handler := newHandler("", clientWith(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://celestrak.org/NORAD/elements/gp.php?CATNR=59051&FORMAT=TLE" || r.Method != "GET" {
			t.Fatal(r.URL)
		}
		return reply(body), nil
	}))
	for n := 0; n < 2; n++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 200 || w.Body.String() != body {
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
		handler := newHandler("", clientWith(func(*http.Request) (*http.Response, error) { return reply(body), nil }))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
		if w.Code != 502 {
			t.Fatal(w.Code)
		}
	}
	handler := newHandler("", clientWith(func(*http.Request) (*http.Response, error) { return nil, errors.New("network failure") }))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/tle?id=59051", nil))
	if w.Code != 502 {
		t.Fatal(w.Code)
	}
}
