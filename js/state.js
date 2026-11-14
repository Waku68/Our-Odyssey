// いまの保存先（store）と、読みこんだデータ（data）。ほかのファイルはここから読む。
// 入れかえるのは setStore / setData だけ（import した側には、入れかえたあとの中身がそのまま見える）。
import { tr } from './i18n.js?v=39';

let store = null;
let data = { entries: [], moods: [], comments: [], profiles: [] };
const setStore = (s) => { store = s; };
const setData = (d) => { data = d; };

const me = () => store.user().id;
const nameOf = (id) => (data.profiles.find((p) => p.id === id)?.display_name) || tr('ななし', 'No name');
const partner = () => data.profiles.find((p) => p.id !== me());
const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : 1);

export { store, data, setStore, setData, me, nameOf, partner, byCreated };
