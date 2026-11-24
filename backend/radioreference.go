package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const endpoint = "https://api.radioreference.com/soap2/index.php"
const maxResponse = 4 * 1024 * 1024
const rejected = "RadioReference rejected the request. Check your Premium login and application key."

type aliasRule struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Group  string `json:"group"`
	Origin string `json:"origin"`
}

func newHandler(key string, client *http.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/tle", tleHandler(client))
	mux.HandleFunc("/api/armer/aliases", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		send := func(code int, value any) { w.WriteHeader(code); _ = json.NewEncoder(w).Encode(value) }
		fail := func(code int, message string) { send(code, map[string]string{"error": message}) }
		if r.Method == http.MethodGet {
			send(http.StatusOK, map[string]bool{"configured": key != ""})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			fail(http.StatusMethodNotAllowed, "Use GET or POST.")
			return
		}
		origin, err := url.Parse(r.Header.Get("Origin"))
		if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host != r.Host || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			fail(http.StatusForbidden, "Use the app to request aliases.")
			return
		}
		if key == "" {
			fail(http.StatusServiceUnavailable, "Set RR_APP_KEY on the API server and restart it. RadioReference requires an approved application key and a Premium account.")
			return
		}
		mediaType, _, contentTypeErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if contentTypeErr != nil || mediaType != "application/json" {
			fail(http.StatusUnsupportedMediaType, "Expected JSON.")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16384))
		if err != nil {
			fail(http.StatusRequestEntityTooLarge, "Request too large.")
			return
		}
		var credentials struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if json.Unmarshal(body, &credentials) != nil || credentials.Username == "" || credentials.Password == "" || utf8.RuneCountInString(credentials.Username) > 240 || utf8.RuneCountInString(credentials.Password) > 1000 {
			fail(http.StatusBadRequest, "Enter your RadioReference username and password.")
			return
		}
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, strings.NewReader(requestXML(credentials.Username, credentials.Password, key)))
		if err != nil {
			fail(http.StatusBadGateway, "Alias lookup failed.")
			return
		}
		request.Header.Set("Content-Type", "text/xml; charset=utf-8")
		request.Header.Set("SOAPAction", `"http://api.radioreference.com/soap2#getTrsTalkgroups"`)
		response, err := client.Do(request)
		if err != nil {
			fail(http.StatusBadGateway, "RadioReference is unavailable. Try again later.")
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			fail(http.StatusBadGateway, "RadioReference is unavailable or rejected authentication.")
			return
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
		if err != nil || len(data) > maxResponse {
			fail(http.StatusBadGateway, "Invalid directory response.")
			return
		}
		rules, err := parseAliases(data)
		if err != nil {
			fail(http.StatusBadGateway, err.Error())
			return
		}
		send(http.StatusOK, struct {
			Rules  []aliasRule `json:"rules"`
			System int         `json:"system"`
		}{rules, 3508})
	})
	return mux
}

func requestXML(username, password, key string) string {
	escape := func(s string) string {
		var buffer bytes.Buffer
		_ = xml.EscapeText(&buffer, []byte(s))
		return buffer.String()
	}
	return `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rr="http://api.radioreference.com/soap2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><soap:Body><rr:getTrsTalkgroups><sid xsi:type="xsd:int">3508</sid><tgCid xsi:type="xsd:int">0</tgCid><tgTag xsi:type="xsd:int">0</tgTag><tgDec xsi:type="xsd:int">0</tgDec><authInfo xsi:type="rr:authInfo"><username>` + escape(username) + `</username><password>` + escape(password) + `</password><appKey>` + escape(key) + `</appKey><version>17</version><style>rpc</style></authInfo></rr:getTrsTalkgroups></soap:Body></soap:Envelope>`
}

type xmlNode struct {
	name, id, href string
	parts          []any
	children       []*xmlNode
}

func parseAliases(data []byte) ([]aliasRule, error) {
	invalid := errors.New("Invalid directory response.")
	if len(data) > maxResponse {
		return nil, invalid
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var stack, nodes []*xmlNode
	ids := map[string]*xmlNode{}
	roots := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, invalid
		}
		switch value := token.(type) {
		case xml.Directive:
			return nil, invalid // No DTD/entity declarations.
		case xml.StartElement:
			if len(stack) >= 64 || len(nodes) >= 100000 {
				return nil, invalid
			}
			node := &xmlNode{name: value.Name.Local}
			if node.name == "Fault" {
				return nil, errors.New(rejected)
			}
			for _, attr := range value.Attr {
				if attr.Name.Local == "id" {
					node.id = attr.Value
				}
				if attr.Name.Local == "href" {
					node.href = attr.Value
				}
			}
			if len(stack) != 0 {
				parent := stack[len(stack)-1]
				parent.children = append(parent.children, node)
				parent.parts = append(parent.parts, node)
			} else {
				roots++
			}
			if node.id != "" {
				ids[node.id] = node
			}
			nodes = append(nodes, node)
			stack = append(stack, node)
		case xml.EndElement:
			if len(stack) == 0 {
				return nil, invalid
			}
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if len(stack) != 0 {
				node := stack[len(stack)-1]
				node.parts = append(node.parts, string(value))
			} else if strings.TrimSpace(string(value)) != "" {
				return nil, invalid
			}
		}
	}
	if roots != 1 || len(stack) != 0 {
		return nil, invalid
	}
	var textContent func(*xmlNode) string
	textContent = func(node *xmlNode) string {
		var text strings.Builder
		for _, part := range node.parts {
			switch value := part.(type) {
			case string:
				text.WriteString(value)
			case *xmlNode:
				text.WriteString(textContent(value))
			}
		}
		return text.String()
	}
	value := func(node *xmlNode) string {
		if strings.HasPrefix(node.href, "#") {
			if target := ids[strings.TrimPrefix(node.href, "#")]; target != nil {
				node = target
			}
		}
		return textContent(node)
	}
	groups := map[int]aliasRule{}
	for _, node := range nodes {
		fields := map[string]*xmlNode{}
		for _, child := range node.children {
			fields[child.name] = child
		}
		dec := fields["tgDec"]
		if dec == nil {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSpace(value(dec)))
		if err != nil || id < 1 || id > 65535 {
			continue
		}
		name := "Talkgroup " + strconv.Itoa(id)
		if field := fields["tgAlpha"]; field != nil {
			name = value(field)
		} else if field := fields["tgDescr"]; field != nil {
			name = value(field)
		}
		runes := []rune(name)
		if len(runes) > 240 {
			name = string(runes[:240])
		}
		groups[id] = aliasRule{ID: id, Name: name, Group: "ARMER", Origin: "radioreference"}
	}
	if len(groups) == 0 || len(groups) > 10000 {
		return nil, errors.New("RadioReference returned no usable ARMER talkgroups.")
	}
	rules := make([]aliasRule, 0, len(groups))
	for _, rule := range groups {
		rules = append(rules, rule)
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].ID < rules[j].ID })
	return rules, nil
}
