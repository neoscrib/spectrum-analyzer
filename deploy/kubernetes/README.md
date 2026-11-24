# Homelab deployment

Spectrum is served at **https://spectrumsdr.com** in namespace `myapps`.
The browser talks directly to the local RTL-SDR; the cluster needs no USB
devices or persistent volumes. nginx serves the app, and a separate Go service
handles the optional RadioReference lookup.

Prerequisites: the existing `myapps` namespace, `myapps-gateway` (Traefik,
HTTPS on port 8443), `letsencrypt-prod-spaceship` ClusterIssuer, and `ghcr-pull`
image pull secret. DNS must point `spectrumsdr.com` at the existing ingress.
These manifests are maintained in this repository and applied with kubectl;
the separate homelab migration repository is not their reconciliation source.

## Deploy

Push application changes to `master` and wait for **Publish image** to succeed.
Update both image tags and digests in `kustomization.yaml` to that build before
deploying. The checked-in versions pin the desired production release;
new `latest` tags do not change running pods.

```sh
kubectl apply --dry-run=server -k deploy/kubernetes
kubectl apply -f deploy/kubernetes/certificate.yaml
kubectl wait -n myapps --for=condition=Ready certificate/spectrumsdr-cert --timeout=5m
python3 deploy/kubernetes/configure-gateway.py --dry-run
python3 deploy/kubernetes/configure-gateway.py
kubectl apply -k deploy/kubernetes
kubectl rollout status -n myapps deployment/spectrum-analyzer
kubectl rollout status -n myapps deployment/spectrum-analyzer-api
curl -I https://spectrumsdr.com
curl https://spectrumsdr.com/api/armer/aliases
```

The listener script adds only `spectrumsdr-https` to the shared Gateway, preserves
all existing listeners, refuses conflicting settings, and can be rerun safely.
cert-manager obtains and renews `spectrumsdr-cert` using the existing Spaceship
DNS-01 webhook. No DNS API keys or certificate private keys belong in this repo.

The HTTPRoute sends `/api` directly to Go and `/` to nginx. This preserves the
public Host and Origin for the API's origin check and bypasses nginx's
Docker-Compose-specific resolver. Neither service has a public NodePort.

## Optional RadioReference key

The API starts without a developer application key and reports
`{"configured":false}`. Radio reception, offline use, and saved/manual aliases
remain available. To enable lookup, put only `RR_APP_KEY=...` in an ignored local
env file, then create the runtime secret without putting its value on the
command line:

```sh
kubectl create secret generic spectrum-analyzer-api -n myapps \
  --from-env-file=.env.local --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/spectrum-analyzer-api -n myapps
```

Each user still provides their own RadioReference Premium login in the app.
Credentials and API responses are excluded from the offline cache.

## Verify and roll back

Both Deployments have startup, readiness, and liveness probes, resource limits,
and rolling updates with zero unavailable replicas. Verify certificate `Ready`,
Gateway listener `Programmed`, HTTPRoute `Accepted`/`ResolvedRefs`, both pod
image IDs, and an HTTPS browser load before considering a rollout complete.
The app menu should reach **Offline ready**; it can then reload with the browser
offline. Opening the app on a new domain starts a separate browser preference
store and requires a new USB permission grant.

For an application update, restore the previous image pins and reapply, or use
`kubectl rollout undo deployment/<name> -n myapps` for an immediate rollback
and then restore the pins.
To uninstall, remove only the `spectrumsdr-https` listener from `myapps-gateway`,
then run `kubectl delete -k deploy/kubernetes`. This leaves the shared Gateway,
namespace, issuer, registry credentials, and other applications in place.
