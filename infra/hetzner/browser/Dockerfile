FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    ca-certificates \
    dbus-x11 \
    fonts-dejavu-core \
    mousepad \
    novnc \
    socat \
    tini \
    websockify \
    x11vnc \
    xvfb \
    xfce4 \
    xfce4-terminal \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 browser \
  && useradd --system --uid 1001 --gid browser --create-home browser \
  && install -d -m 700 -o browser -g browser /home/browser/profile /home/browser/Desktop /home/browser/Downloads \
  && install -d -m 1777 -o root -g root /tmp/.X11-unix

# ICE sockets must live in a root-owned sticky directory. Without it XFCE's
# session manager disconnects and launchers such as Terminal appear to do nothing.
RUN install -d -m 1777 -o root -g root /tmp/.ICE-unix

COPY --chown=root:root infra/hetzner/browser/entrypoint.sh /usr/local/bin/aibrain-browser
RUN chmod 0755 /usr/local/bin/aibrain-browser

USER browser
WORKDIR /home/browser

ENV DISPLAY=:99
ENV HOME=/home/browser
ENV SCREEN_SIZE=1440x900

EXPOSE 6080 9223

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aibrain-browser"]
