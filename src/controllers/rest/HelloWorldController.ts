import { Controller, Inject } from '@tsed/di';
import {
  Description, Get, Returns, Summary,
} from '@tsed/schema';

import HelloWorldService from './HelloWorldService.js';

@Controller('/hello-world')
export class HelloWorldController {
  @Inject(HelloWorldService)
  protected helloWorldService: HelloWorldService;

  @Get('/')
  @Summary('Summary of this route')
  @Description('Description of this route')
  @(Returns(200, String).ContentType('text/plain'))
  async get() {
    console.log(await this.helloWorldService.ping());
    return 'hello';
  }
}
