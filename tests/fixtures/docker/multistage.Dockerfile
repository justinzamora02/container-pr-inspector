FROM alpine:3.22 AS build
RUN echo payload > /payload

FROM scratch AS runtime
COPY --from=build /payload /payload
USER 10001
HEALTHCHECK CMD ["/payload"]
