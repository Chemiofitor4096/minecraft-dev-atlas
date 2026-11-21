/**
 * 一个最小 createElement 绑定：客户端半边不引 JSX 构建链，组件用 h() 手写。
 * @module minecraft-dev-atlas/client/h
 */

import { createElement } from 'react'

export const h = createElement
