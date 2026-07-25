FROM alpine:3.22
RUN adduser -D -u 10001 app
USER 10001
HEALTHCHECK --interval=30s CMD true
CMD ["true"]
