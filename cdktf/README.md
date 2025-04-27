# CDKTF

## Develop

```sh
node --enable-source-maps --import @swc-node/register/esm-register --watch main.ts
```

## Build

```sh
cdktf synth
cdktf deploy ImagesStack --auto-approve
```

## Deploy

```sh
cdktf deploy ImagesStack --auto-approve
cdktf deploy DeploymentStack --auto-approve --ignore-missing-stack-dependencies --outputs-file-include-sensitive-outputs --outputs-file outputs.json
cdktf deploy ImagesStack DeploymentStack --auto-approve
```
