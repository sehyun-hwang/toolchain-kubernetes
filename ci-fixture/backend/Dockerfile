ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app
COPY --chown=1000:1000 server.cjs /app/server.cjs
USER 1000:1000
EXPOSE 8080
CMD ["node", "/app/server.cjs"]
