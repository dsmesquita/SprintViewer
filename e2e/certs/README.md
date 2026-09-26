# Test certificate — not a secret

`untrusted.crt` / `untrusted.key` are a self-signed certificate for `127.0.0.1`, made only for
the end-to-end tests of the "Trust certificates from" setting (`e2e/certificates.spec.ts`). No
machine trusts it, which is the point: it stands in for an on-prem TFS behind an internal CA.
The key protects nothing and is committed on purpose.

Made with (valid for 100 years):

```
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 \
  -keyout untrusted.key -out untrusted.crt \
  -subj "/CN=127.0.0.1/O=Sprint Viewer e2e tests (not trusted)" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
```
