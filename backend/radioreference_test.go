package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const soapFixture = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getTrsTalkgroupsResponse><return><item href="#group1"/></return></getTrsTalkgroupsResponse><multiRef id="group1"><tgDec>6620</tgDec><tgAlpha href="#name1"/><tgDescr>Dispatch</tgDescr></multiRef><multiRef id="name1">Kanabec &amp; Test</multiRef><item><tgDec>6640</tgDec><tgDescr>City <b>Dispatch</b> Ops</tgDescr></item><item><tgDec>65536</tgDec><tgAlpha>Invalid</tgAlpha></item></soap:Body></soap:Envelope>`

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func clientWith(f roundTrip) *http.Client {
	return &http.Client{Transport: f, Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func reply(body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
func post(body string) *http.Request {
	r := httptest.NewRequest("POST", "http://localhost:8080/api/armer/aliases", strings.NewReader(body))
	r.Header.Set("Origin", "http://localhost:8080")
	r.Header.Set("Content-Type", "application/json")
	return r
}

func TestSOAPAndAliases(t *testing.T) {
	rules, err := parseAliases([]byte(soapFixture))
	if err != nil || len(rules) != 2 || rules[0].ID != 6620 || rules[0].Name != "Kanabec & Test" || rules[1].Name != "City Dispatch Ops" {
		t.Fatalf("rules=%+v error=%v", rules, err)
	}
	if rules[0].Origin != "radioreference" || rules[0].Group != "ARMER" {
		t.Fatal(rules)
	}
	payload := requestXML(`user&name`, `<password&"'>`, `key<&`)
	decoder := xml.NewDecoder(strings.NewReader(payload))
	values := map[string]string{}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if start, ok := token.(xml.StartElement); ok && (start.Name.Local == "username" || start.Name.Local == "password" || start.Name.Local == "appKey" || start.Name.Local == "sid") {
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				t.Fatal(err)
			}
			values[start.Name.Local] = value
		}
	}
	if values["username"] != `user&name` || values["password"] != `<password&"'>` || values["appKey"] != `key<&` || values["sid"] != "3508" {
		t.Fatal(values)
	}
}
func TestInvalidSOAP(t *testing.T) {
	for _, body := range []string{"", `<Envelope>`, `<a/><b/>`, `<!DOCTYPE a><Envelope/>`, `<Envelope><Fault><faultstring>private-password</faultstring></Fault></Envelope>`, `<Envelope><item><tgDec>0</tgDec></item></Envelope>`, strings.Repeat("<x>", 65) + strings.Repeat("</x>", 65), strings.Repeat(" ", maxResponse+1)} {
		_, err := parseAliases([]byte(body))
		if err == nil || strings.Contains(err.Error(), "private-password") {
			t.Fatalf("expected a sanitized error, got %v", err)
		}
	}
}
func TestHandlerLookup(t *testing.T) {
	calls := 0
	client := clientWith(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "POST" || r.URL.String() != endpoint || r.Header.Get("SOAPAction") != `"http://api.radioreference.com/soap2#getTrsTalkgroups"` {
			t.Fatalf("invalid upstream %s", r.URL)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "<appKey>server-only</appKey>") || !strings.Contains(string(body), "<password>private-password</password>") {
			t.Fatal("missing SOAP auth")
		}
		return reply(soapFixture), nil
	})
	handler := newHandler("server-only", client)
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest("GET", "http://localhost:8080/api/armer/aliases", nil))
	if status.Body.String() != "{\"configured\":true}\n" {
		t.Fatal(status.Body.String())
	}
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, post(`{"username":"user","password":"private-password"}`))
	if result.Code != 200 || calls != 1 || result.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s", result.Code, result.Body.String())
	}
	var data struct {
		Rules  []aliasRule
		System int
	}
	if err := json.Unmarshal(result.Body.Bytes(), &data); err != nil || len(data.Rules) != 2 || data.System != 3508 {
		t.Fatalf("%+v %v", data, err)
	}
	if strings.Contains(result.Body.String(), "server-only") || strings.Contains(result.Body.String(), "private-password") {
		t.Fatal("credentials escaped response boundary")
	}
}
func TestRequestGuards(t *testing.T) {
	calls := 0
	client := clientWith(func(*http.Request) (*http.Response, error) { calls++; return reply(soapFixture), nil })
	for _, tc := range []struct {
		name, key, body, origin, contentType, fetchSite, method string
		code                                                    int
	}{
		{name: "no key", body: `{}`, origin: "http://localhost:8080", contentType: "application/json", method: "POST", code: 503},
		{name: "bad credentials", key: "key", body: `{}`, origin: "http://localhost:8080", contentType: "application/json", method: "POST", code: 400},
		{name: "missing origin", key: "key", body: `{}`, contentType: "application/json", method: "POST", code: 403},
		{name: "cross origin", key: "key", body: `{}`, origin: "https://evil.example", contentType: "application/json", method: "POST", code: 403},
		{name: "cross site", key: "key", body: `{}`, origin: "http://localhost:8080", contentType: "application/json", fetchSite: "cross-site", method: "POST", code: 403},
		{name: "invalid type", key: "key", body: `{}`, origin: "http://localhost:8080", contentType: "application/json-bogus", method: "POST", code: 415},
		{name: "bad JSON", key: "key", body: `[`, origin: "http://localhost:8080", contentType: "application/json", method: "POST", code: 400},
		{name: "oversize", key: "key", body: strings.Repeat("x", 16385), origin: "http://localhost:8080", contentType: "application/json", method: "POST", code: 413},
		{name: "method", key: "key", method: "DELETE", code: 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "http://localhost:8080/api/armer/aliases", strings.NewReader(tc.body))
			request.Header.Set("Origin", tc.origin)
			request.Header.Set("Content-Type", tc.contentType)
			request.Header.Set("Sec-Fetch-Site", tc.fetchSite)
			result := httptest.NewRecorder()
			newHandler(tc.key, client).ServeHTTP(result, request)
			if result.Code != tc.code {
				t.Fatalf("%d %s", result.Code, result.Body.String())
			}
		})
	}
	if calls != 0 {
		t.Fatal("rejected requests reached upstream")
	}
}
func TestUpstreamErrorsAreSanitized(t *testing.T) {
	for name, transport := range map[string]roundTrip{
		"network": func(*http.Request) (*http.Response, error) { return nil, errors.New("echo private-password") },
		"status": func(*http.Request) (*http.Response, error) {
			r := reply("private-password")
			r.StatusCode = 401
			return r, nil
		},
		"fault": func(*http.Request) (*http.Response, error) {
			return reply(`<Envelope><Fault>private-password</Fault></Envelope>`), nil
		},
		"large": func(*http.Request) (*http.Response, error) { return reply(strings.Repeat("x", maxResponse+1)), nil },
	} {
		t.Run(name, func(t *testing.T) {
			result := httptest.NewRecorder()
			newHandler("key", clientWith(transport)).ServeHTTP(result, post(`{"username":"user","password":"private-password"}`))
			if result.Code != 502 || strings.Contains(result.Body.String(), "private-password") {
				t.Fatalf("%d %s", result.Code, result.Body.String())
			}
		})
	}
}
func TestDisconnectCancelsUpstream(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := clientWith(func(r *http.Request) (*http.Response, error) {
		if r.Context().Err() == nil {
			t.Error("missing request cancellation")
		}
		return nil, r.Context().Err()
	})
	result := httptest.NewRecorder()
	newHandler("key", client).ServeHTTP(result, post(`{"username":"user","password":"secret"}`).WithContext(ctx))
	if result.Code != 502 {
		t.Fatal(result.Code)
	}
}
