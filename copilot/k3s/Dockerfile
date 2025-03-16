FROM rancher/k3s:v1.30.10-k3s1 AS k3s
FROM quay.io/fedora/fedora-coreos:stable

COPY --from=k3s /bin/aux /bin/aux
COPY --from=k3s bin/k3s* /bin/kubectl /bin/crictl /bin/ctr \
  /bin/host-local /bin/flannel /bin/loopback /bin/bandwidth /bin/portmap /bin/bridge \
  /bin/

RUN rpm-ostree uninstall nano-default-editor \
  && rpm-ostree override remove nfs-utils-coreos --install nfs-utils \
  && rpm-ostree install \
  fish vim efs-utils \
  https://github.com/k3s-io/k3s-selinux/releases/download/v1.6.stable.1/k3s-selinux-1.6-1.coreos.noarch.rpm \
  && ostree container commit

RUN curl https://raw.githubusercontent.com/k3s-io/k3s/master/k3s.service \
  | sed 's,ExecStart=/usr/local/bin/k3s server,ExecStart=/bin/k3s server,;w /usr/lib/systemd/system/k3s.service'  \
  && ln -s /k3s.service /usr/lib/systemd/system/multi-user.target.wants
