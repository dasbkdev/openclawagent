import{a as o}from"./baseApi-DSeahOKn.js";const s={login:async t=>o("auth/login",{method:"POST",body:JSON.stringify(t)}),logout:async t=>o("auth/logout",{method:"POST",body:JSON.stringify(t)}),forgotPassword:async t=>o("auth/forgot-password",{method:"POST",body:JSON.stringify(t)}),setPassword:async t=>o("auth/set-password",{method:"POST",body:JSON.stringify(t)})};export{s as a};

