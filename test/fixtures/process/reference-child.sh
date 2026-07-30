#!/bin/sh

environment_path=$1
descendant_pid_path=$2
delay_seconds=$3
leader_pid_path=$4

if [ -n "$leader_pid_path" ]; then
  printf '%s' "$$" > "$leader_pid_path"
fi

if [ -n "$environment_path" ]; then
  /usr/bin/env > "$environment_path"
fi

if [ -n "$descendant_pid_path" ]; then
  /usr/bin/sleep 10 &
  printf '%s' "$!" > "$descendant_pid_path"
fi

/usr/bin/sleep "$delay_seconds"
