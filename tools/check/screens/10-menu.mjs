// Главное меню и справка «Как играть».
export const steps = {
  menu: (ctx) => ctx.shot('menu'),
  menu_help: async (ctx) => { await ctx.click('#m-help'); await ctx.shot('menu_help'); },
};
