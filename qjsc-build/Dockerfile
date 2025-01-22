FROM --platform=linux/amd64 node:17-alpine
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"
RUN apk --no-cache add --update bash build-base
ADD build.sh .
CMD ./build.sh
