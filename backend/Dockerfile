FROM golang:1.26-alpine AS build
WORKDIR /src
COPY backend/go.mod ./
COPY backend/*.go ./
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server .

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /server /server
COPY --from=build /usr/local/go/LICENSE /licenses/Go-LICENSE
USER 65532:65532
ENV LISTEN_ADDR=:8081
EXPOSE 8081
ENTRYPOINT ["/server"]
