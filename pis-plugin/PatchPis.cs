using System;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

public static class PatchPis
{
    public static int Main(string[] args)
    {
        if (args.Length != 3)
        {
            Console.Error.WriteLine("Usage: PatchPis <input.exe> <plugin.dll> <output.exe>");
            return 2;
        }

        string input = args[0];
        string pluginPath = args[1];
        string output = args[2];

        AssemblyDefinition application = AssemblyDefinition.ReadAssembly(input);
        AssemblyDefinition plugin = AssemblyDefinition.ReadAssembly(pluginPath);

        TypeDefinition formType = application.MainModule.Types.First(type => type.FullName == "PIS.PIS");
        MethodDefinition constructor = formType.Methods.First(method => method.Name == ".ctor" && !method.HasParameters);
        MethodDefinition install = plugin.MainModule.Types
            .First(type => type.FullName == "ClinicClick.PisPlugin.Plugin")
            .Methods.First(method => method.Name == "Install");

        MethodReference importedInstall = application.MainModule.ImportReference(install);
        Instruction initializeCall = constructor.Body.Instructions.First(instruction =>
            instruction.OpCode == OpCodes.Call &&
            instruction.Operand is MethodReference &&
            ((MethodReference)instruction.Operand).Name == "InitializeComponent");

        ILProcessor il = constructor.Body.GetILProcessor();
        Instruction loadThis = il.Create(OpCodes.Ldarg_0);
        Instruction callInstall = il.Create(OpCodes.Call, importedInstall);
        il.InsertAfter(initializeCall, loadThis);
        il.InsertAfter(loadThis, callInstall);

        application.Write(output);
        Console.WriteLine("Patched: " + output);
        return 0;
    }
}
