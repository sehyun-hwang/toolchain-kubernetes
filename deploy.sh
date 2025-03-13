set -eux

aws ecr get-login-password --region ap-northeast-1 | nerdctl login --username AWS --password-stdin 248837585826.dkr.ecr.ap-northeast-1.amazonaws.com
docker-buildx build --builder cloud-aedddsehyun1994-default . --platform linux/amd64 -t 248837585826.dkr.ecr.ap-northeast-1.amazonaws.com:443/copilot-default/tsed:latest --push
