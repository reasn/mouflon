interface TaskDefinition {
    task: string;
    prefs: {[key:string]:string};
    mod: string;
}

export = TaskDefinition;