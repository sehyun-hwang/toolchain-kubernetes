
FROM rust:1-alpine AS build

RUN apk add --no-cache musl-dev pkgconfig openssl-dev

WORKDIR /mnt
COPY Cargo.toml Cargo.lock ./
RUN cargo fetch

# https://github.com/sfackler/rust-openssl/issues/1627#issuecomment-1735407736
ENV RUSTFLAGS="-C target-feature=-crt-static"
RUN echo 'fn main() {}' > main.rs \
  && cargo build --locked --release \
  && rm main.rs
COPY main.rs ./
RUN cargo clean -p pgbouncer-userlist --release \
  && cargo build --locked --release

FROM edoburu/pgbouncer

USER root
RUN apk add --no-cache openssl libgcc
RUN mv /entrypoint.sh /upstream-entrypoint.sh

WORKDIR /etc/pgbouncer
COPY --from=build /mnt/target/release/pgbouncer-userlist ./
COPY entrypoint.sh /
COPY kine-entrypoint.sh /bin/
COPY daemon.ini ./

USER postgres
EXPOSE 6432
ENV LISTEN_PORT=6432 \
  AUTH_TYPE=trust \
  SERVER_TLS_SSLMODE=verify-ca \
  SERVER_TLS_CA_FILE=bundle.pem

CMD ["/etc/pgbouncer/pgbouncer-userlist"]
