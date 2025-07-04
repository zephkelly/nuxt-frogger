# Why Frogger?
I created Frogger because I spent an unreasonable amount of time trying to install Sentry, and it just didn't work. So I said, surely this is something I can write myself? I then spent an unreasonable amount of time building Frogger, a simple logging module for Nuxt that works out of the box.

Some other reasons:
- Frogger does more than just log, it also traces requests. This means I can follow the flow of a request through my application code, from the server to the client, and back again.
  
  My goal is to include more performance and metric based features so that Frogger could act as an all-in-one observability solution.
- Most logging libraries are designed for the backend. Frogger is designed to work seamlessly in both server and client environments.
- I can choose to self host my entire logging pipeline, or I can also send logs off to external services like Sentry, Logflare, or my own custom endpoints 

## Who is this for?
This module is for solo developers or smaller teams who use Nuxt and want a simple, opinionated logging solution that just works. Frogger is NOT built for your highly-distributed, multi-region microservice architecture running on seventeen Kubernetes clusters (although we do follow [W3C Trace Context Standards](https://www.w3.org/TR/trace-context/) so I would love to hear from you if you do get it running in such an environment). It is designed to be easy to use, with minimal configuration required.

## What about long-term?
This is a library that I use in all my own projects. It is incorporated in multiple production applications at the company I work for. It is a library that I rely on daily and I will continue to maintain for the foreseeable future. I would love to see it grow and I'll always welcome contributions, suggestions, and feedback. If you have any ideas for features or improvements, please visit the [GitHub repository](https://github.com/zephkelly/nuxt-frogger) and open an issue or pull request.