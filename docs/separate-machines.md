# Run Shallot on separate machines

This runbook places each trust boundary on a different host:

```text
Client host                Relay host                 Exit host
AI SDK -> Sidecar -> SSH tunnel -> Relay -> SSH tunnel -> Exit -> Provider
          :8788                         :8787                      :8786    :8785
```

All Shallot services bind to `127.0.0.1`. SSH forwards traffic between hosts,
so the Shallot ports do not need to be public.

This setup is for development. SSH protects traffic between hosts, while HPKE
keeps request content hidden from Relay. Relay and Exit can recover both identity
and content if they collude.

## Prerequisites

- Clone the repository into `~/shallot` on each host.
- Install the version of Bun listed in the root `package.json` on each host.
- Run `bun install --frozen-lockfile` in each checkout.
- Configure the SSH aliases `shallot-relay` and `shallot-exit` where the commands
  below use them.
- Use a provider reachable from the Exit host. The included mock provider works
  for local testing and costs nothing.

Example SSH client configuration:

```sshconfig
Host shallot-relay
  HostName relay.example.com
  User deploy

Host shallot-exit
  HostName exit.example.com
  User deploy
```

## Create the Exit key

Generate the recipient key pair on the Exit host:

```sh
ssh shallot-exit
cd ~/shallot
bun run keygen
```

Keep `.shallot/keys/exit-private.key` on the Exit host. Copy only the public key
to the client host. Run this from the client checkout:

```sh
mkdir -p .shallot/keys
scp shallot-exit:shallot/.shallot/keys/exit-public.key \
  .shallot/keys/exit-public.key
```

## Restrict the Relay-to-Exit tunnel key

Create a dedicated SSH key on the Relay host:

```sh
ssh-keygen -t ed25519 -N '' \
  -C 'shallot-tunnel@relay-host' \
  -f ~/.ssh/shallot_exit_tunnel
cat ~/.ssh/shallot_exit_tunnel.pub
```

Add the public key to `~/.ssh/authorized_keys` on the Exit host. Prefix it with
these options:

```text
restrict,port-forwarding,permitopen="127.0.0.1:8786" ssh-ed25519 AAAA... shallot-tunnel@relay-host
```

The key cannot open a shell or forward traffic anywhere except the Exit service.
Add a `shallot-exit` SSH alias on the Relay host that selects this key:

```sshconfig
Host shallot-exit
  HostName exit.example.com
  User deploy
  IdentityFile ~/.ssh/shallot_exit_tunnel
  IdentitiesOnly yes
```

## Start the provider and Exit

On the Exit host, open two terminals or tmux windows in `~/shallot`.

Start the mock provider:

```sh
SHALLOT_LOG_LEVEL=debug \
MOCK_PROVIDER_API_KEY=provider-local \
bun packages/mock-provider/src/main.ts
```

Start Exit:

```sh
SHALLOT_LOG_LEVEL=debug \
EXIT_PRIVATE_KEY="$(<.shallot/keys/exit-private.key)" \
EXIT_RELAY_TOKEN=relay-to-exit-local \
EXIT_PROVIDER_API_KEY=provider-local \
bun packages/exit/src/main.ts
```

The mock provider listens on `127.0.0.1:8785`. Exit listens on
`127.0.0.1:8786`.

## Start the Exit tunnel and Relay

On the Relay host, open two terminals or tmux windows.

Start the tunnel to Exit:

```sh
ssh -NT \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:8786:127.0.0.1:8786 \
  shallot-exit
```

From `~/shallot`, start Relay:

```sh
SHALLOT_LOG_LEVEL=debug \
RELAY_TENANT_TOKENS=demo:tenant-local \
RELAY_EXIT_TOKEN=relay-to-exit-local \
bun packages/relay/src/main.ts
```

Relay listens on `127.0.0.1:8787` and reaches Exit through the local tunnel on
port 8786.

## Start the Relay tunnel and Sidecar

On the client host, open two terminals or tmux windows.

Start the tunnel to Relay:

```sh
ssh -NT \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:8787:127.0.0.1:8787 \
  shallot-relay
```

From `~/shallot`, start Sidecar:

```sh
SHALLOT_LOG_LEVEL=debug \
SIDECAR_RELAY_URL=http://127.0.0.1:8787/v1/chat/completions \
SIDECAR_EXIT_PUBLIC_KEY="$(<.shallot/keys/exit-public.key)" \
bun packages/client/src/main.ts
```

Point the AI SDK at `http://127.0.0.1:8788/v1` and use `tenant-local` as its API
key.

## Optional tmux layout

```text
Client host  shallot-client  relay-tunnel, sidecar
Relay host   shallot-relay   exit-tunnel, relay
Exit host    shallot-exit    provider, exit
```

tmux keeps each process alive after an SSH disconnect. It does not restart the
processes after a reboot. Use a service manager for a persistent deployment.

## Stop the deployment

On the client host:

```sh
tmux kill-session -t shallot-client
```

On the Relay host:

```sh
tmux kill-session -t shallot-relay
```

On the Exit host:

```sh
tmux kill-session -t shallot-exit
```

On Linux, check that no Shallot listener remains:

```sh
ss -ltn | grep -E ':(8785|8786|8787|8788) ' || true
```

On macOS, use:

```sh
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8785|8786|8787|8788) ' || true
```
